import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { Session, SessionId, type SessionEvent, type UserMessage } from '@deepseek-ai/dsh-session'
import SessionTreeService, { SessionTreeSidecar, setSessionTreeSidecar } from '../src/index.ts'

const directory = mkdtempSync(join(tmpdir(), 'dsh-edit-prompt-'))
let serial = 0
beforeEach(() => {
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  setSessionTreeSidecar(new SessionTreeSidecar(directory))
})
afterAll(() => rmSync(directory, { recursive: true, force: true }))

function user(text: string, extra: UserMessage['content'] = []): UserMessage {
  return { id: `message-${++serial}` as UserMessage['id'], role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }, ...extra] }
}
function stub(seed: readonly SessionEvent[] = []): Agent {
  const id = SessionId(`edit-test-${++serial}`)
  return {
    id, options: { provider: 'test', model: 'test' }, ctx: new Context(),
    session: Session.create(id, seed, { version: 4, id, createdAt: 0, cwd: '/workspace/test', isSeeded: false }),
    inbox: { nextTurn: [], nextStep: [] } as unknown as Agent['inbox'],
    status: 'idle', send: vi.fn(), followup: vi.fn(), steer: vi.fn(), inject: vi.fn(),
    cancel: vi.fn(), whenIdle: vi.fn(async () => {}), runMaintenance: task => task(new AbortController().signal),
  }
}
async function harness() {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionTreeService)
  const created: { options: CreateAgentOptions; agent: Agent; dispose: ReturnType<typeof vi.fn> }[] = []
  ctx.agents.setFactory({
    createAgent: async (_ctx, options) => {
      const agent = stub(options.seed)
      const entry = { options, agent, dispose: vi.fn(async () => {}) }
      created.push(entry)
      return entry
    },
    resume: async () => { throw new Error('unused') },
  })
  return { ctx, service: ctx.sessionTree, created }
}
function prompt(agent: Agent, text: string, extra: UserMessage['content'] = []) {
  return agent.session.append('user/message', user(text, extra), { surfaceOp: 'append' })
}
function turn(agent: Agent, turnNumber: number, text: string, answer: string) {
  agent.session.append('turn/start', { turn: turnNumber })
  agent.session.append('step/start', { turn: turnNumber, step: 1 })
  prompt(agent, text)
  agent.session.append('assistant/message', {
    turn: turnNumber, step: 1, stream: [], message: {
      id: `answer-${++serial}` as UserMessage['id'], role: 'assistant',
      source: { kind: 'model', provider: 'test', model: 'test' }, content: [{ type: 'text', text: answer }],
    },
  }, { surfaceOp: 'append' })
  agent.session.append('step/end', { turn: turnNumber, step: 1 })
  agent.session.append('turn/end', { turn: turnNumber, reason: { kind: 'completed' } })
}

describe('latest prompt editing', () => {
  it('aborts synchronously, waits for quiescence, preserves pending injections, and reuses a stopped draft', async () => {
    const { service, created } = await harness()
    const agent = stub()
    prompt(agent, '  unfinished\nline  ')
    let idle!: () => void
    vi.mocked(agent.whenIdle).mockImplementation(() => new Promise(resolve => { idle = resolve }))
    const first = service.beginEdit(agent)
    const second = service.beginEdit(agent)
    expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    expect(created).toHaveLength(0)
    let settled = false
    void first.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    idle()
    const edit = await first
    expect(await second).toEqual(edit)
    expect(edit.prompt).toBe('  unfinished\nline  ')
    vi.mocked(agent.whenIdle).mockResolvedValue()
    expect(await service.beginEdit(agent)).toEqual(edit)
  })

  it('stops owned child and grandchild work without touching unrelated sessions or forks', async () => {
    const { ctx, service } = await harness()
    const agent = stub(), child = stub(), grandchild = stub(), unrelated = stub(), fork = stub()
    prompt(agent, 'fix this')
    vi.spyOn(ctx.agents, 'list').mockReturnValue([agent, child, grandchild, unrelated, fork])
    vi.spyOn(ctx.agents, 'isOwnedBy').mockImplementation((id, owner) => (id === child.id && owner === agent) || (id === grandchild.id && owner === child))
    await service.beginEdit(agent)
    for (const stopped of [agent, child, grandchild]) {
      expect(stopped.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
      expect(stopped.whenIdle).toHaveBeenCalled()
    }
    expect(unrelated.cancel).not.toHaveBeenCalled()
    expect(fork.cancel).not.toHaveBeenCalled()
  })

  it('ignores injected prompts and refuses pending user input rather than editing the wrong message', async () => {
    const { service } = await harness()
    const agent = stub()
    prompt(agent, 'typed prompt')
    agent.session.append('user/message', { ...user('catalog'), source: { kind: 'skill-catalog' } } as never, { surfaceOp: 'append' })
    expect((await service.beginEdit(agent)).prompt).toBe('typed prompt')
    const queued = [user('newer queued prompt')]
    Object.assign(agent.inbox, { nextTurn: queued })
    await expect(service.beginEdit(agent)).rejects.toThrow('edit it in the message queue first')
    expect(agent.inbox.nextTurn).toEqual(queued)
    expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
  })

  it('creates a corrected continuation with prior turns and attachments, retaining the original transcript', async () => {
    const { service, created } = await harness()
    const agent = stub()
    turn(agent, 1, 'earlier question', 'earlier answer')
    const image = { type: 'image', mimeType: 'image/png', attachment: { id: 'durable-image-ref' } } as unknown as UserMessage['content'][number]
    prompt(agent, 'wrong prompt', [image])
    const before = agent.session.snapshotEvents()
    const edit = await service.beginEdit(agent)
    expect(edit.attachmentCount).toBe(1)
    const result = await service.submitEdit(agent, edit.editId, 'correct prompt')
    expect(result).toMatchObject({ nodeId: edit.nodeId, prompt: 'correct prompt', previousUserPrompt: 'earlier question' })
    const target = created[0]!
    expect(target.options.meta).toMatchObject({ parentSession: agent.id, cwd: '/workspace/test' })
    expect(target.options.agentOptions).toEqual(agent.options)
    expect(target.options.seed?.filter(event => event.type === 'user/message').map(event => event.data.content)).toEqual([[{ type: 'text', text: 'earlier question' }]])
    expect(target.options.seed?.map(event => event.seq)).toEqual(target.options.seed?.map((_event, index) => index))
    expect(target.agent.send).toHaveBeenCalledWith(expect.objectContaining({ content: [{ type: 'text', text: 'correct prompt' }, image] }), 'next-turn', true)
    expect(agent.session.snapshotEvents()).toEqual(before)
    expect(agent.send).not.toHaveBeenCalled()
    await expect(service.submitEdit(agent, edit.editId, 'twice')).rejects.toThrow('expired')
    expect(created).toHaveLength(1)
  })

  it('edits the actual latest stock surface after a historical tree jump and preserves complete earlier history', async () => {
    const { service, created } = await harness()
    const agent = stub()
    turn(agent, 1, 'first', 'first answer')
    turn(agent, 2, 'second', 'second answer')
    prompt(agent, 'latest')
    const first = service.list(agent).nodes.find(node => node.summary === 'first')!
    service.jump(agent, first.nodeId)
    const edit = await service.beginEdit(agent)
    expect(edit.prompt).toBe('latest')
    await service.submitEdit(agent, edit.editId, 'latest corrected')
    expect(created[0]?.options.seed?.filter(event => event.type === 'user/message').map(event => event.data.content)).toEqual([
      [{ type: 'text', text: 'first' }], [{ type: 'text', text: 'second' }],
    ])
  })

  it('starts a first-prompt correction from an empty seed and does not create anything until submit', async () => {
    const { service, created } = await harness()
    const agent = stub()
    prompt(agent, 'first unfinished')
    const edit = await service.beginEdit(agent)
    expect(created).toHaveLength(0)
    await expect(service.submitEdit(agent, edit.editId, '  ')).rejects.toThrow('must not be empty')
    expect(created).toHaveLength(0)
    await service.submitEdit(agent, edit.editId, 'finished')
    expect(created[0]?.options.seed).toBeUndefined()
    expect(created[0]?.agent.send).toHaveBeenCalledTimes(1)
  })

  it('follows the selected model surface on native branch hosts', async () => {
    const { service, created } = await harness()
    const agent = stub()
    const first = prompt(agent, 'selected branch prompt')
    prompt(agent, 'other branch prompt')
    Object.assign(agent.session, {
      selectMessageSurface: vi.fn(),
      messageSurfaceNodes: () => [first.seq],
    })
    const edit = await service.beginEdit(agent)
    expect(edit.prompt).toBe('selected branch prompt')
    await service.submitEdit(agent, edit.editId, 'correct branch prompt')
    expect(created[0]?.options.seed).toBeUndefined()
  })

  it('balances seeded step/turn boundaries when editing steering within a completed turn', async () => {
    const { service, created } = await harness()
    const agent = stub()
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    prompt(agent, 'original task')
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('step/start', { turn: 1, step: 2 })
    prompt(agent, 'wrong steering')
    agent.session.append('step/end', { turn: 1, step: 2 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    const edit = await service.beginEdit(agent)
    await service.submitEdit(agent, edit.editId, 'correct steering')
    const seed = created[0]?.options.seed ?? []
    let turns = 0, steps = 0
    for (const event of seed) {
      if (event.type === 'turn/start') turns++
      if (event.type === 'turn/end') turns--
      if (event.type === 'step/start') steps++
      if (event.type === 'step/end') steps--
      expect(turns).toBeGreaterThanOrEqual(0)
      expect(steps).toBeGreaterThanOrEqual(0)
    }
    expect(turns).toBe(0)
    expect(steps).toBe(0)
    expect(seed.filter(event => event.type === 'user/message')).toHaveLength(1)
  })

  it('rolls back workspace membership and child ownership when prompt admission fails', async () => {
    const { ctx, service, created } = await harness()
    const agent = stub()
    prompt(agent, 'wrong')
    const attached: string[] = []
    const detach = vi.fn(async (id: string) => { attached.splice(attached.indexOf(id), 1) })
    ctx.provide('workspaceRegistry', { list: () => [{
      sessionIds: [agent.id],
      attachSession: async (id: string) => { attached.push(id) },
      detachSession: detach,
    }] } as never)
    const create = ctx.agents.create.bind(ctx.agents)
    vi.spyOn(ctx.agents, 'create').mockImplementation(async options => {
      const handle = await create(options)
      vi.mocked(handle.agent.send).mockImplementationOnce(() => { throw new Error('admission unavailable') })
      return handle
    })
    const edit = await service.beginEdit(agent)
    await expect(service.submitEdit(agent, edit.editId, 'correct')).rejects.toThrow('admission unavailable')
    expect(attached).toEqual([])
    expect(detach).toHaveBeenCalledOnce()
    expect(created[0]?.dispose).toHaveBeenCalledOnce()
  })

  it('rejects stale prompts after another client sends or moves the cursor', async () => {
    const { service, created } = await harness()
    const agent = stub()
    prompt(agent, 'before')
    const edit = await service.beginEdit(agent)
    prompt(agent, 'new from another client')
    await expect(service.submitEdit(agent, edit.editId, 'stale replacement')).rejects.toThrow('stale')
    expect(created).toHaveLength(0)
    const second = await service.beginEdit(agent)
    service.jump(agent, edit.nodeId)
    await expect(service.submitEdit(agent, second.editId, 'stale selection')).rejects.toThrow('stale')
  })

  it('cleans up a partially attached workspace and keeps the correction retryable', async () => {
    const { ctx, service, created } = await harness()
    const agent = stub()
    prompt(agent, 'wrong')
    const attached = new Set<string>()
    const attach = vi.fn(async (id: string) => { attached.add(id) })
    attach.mockImplementationOnce(async id => {
      attached.add(id)
      throw new Error('workspace persistence failed')
    })
    ctx.provide('workspaceRegistry', { list: () => [{
      sessionIds: [agent.id], attachSession: attach,
      detachSession: async (id: string) => { attached.delete(id) },
    }] } as never)
    const edit = await service.beginEdit(agent)
    await expect(service.submitEdit(agent, edit.editId, 'correct')).rejects.toThrow('workspace persistence failed')
    expect(attached.size).toBe(0)
    expect(created[0]?.agent.send).not.toHaveBeenCalled()
    expect(created[0]?.dispose).toHaveBeenCalledOnce()
    const result = await service.submitEdit(agent, edit.editId, 'correct')
    expect(attached.has(result.sessionId)).toBe(true)
    expect(created[1]?.agent.send).toHaveBeenCalledOnce()
  })

  it('rejects concurrent submits and starting another edit during submission', async () => {
    const { ctx, service } = await harness()
    const agent = stub()
    prompt(agent, 'before')
    const edit = await service.beginEdit(agent)
    let resolve!: (value: { agent: Agent; dispose: () => Promise<void> }) => void
    const create = vi.spyOn(ctx.agents, 'create').mockImplementation(() => new Promise(done => { resolve = done }))
    const submitted = service.submitEdit(agent, edit.editId, 'corrected')
    await expect(service.submitEdit(agent, edit.editId, 'duplicate')).rejects.toThrow('already been submitted')
    await expect(service.beginEdit(agent)).rejects.toThrow('being submitted')
    const child = stub()
    resolve({ agent: child, dispose: async () => {} })
    await submitted
    expect(create).toHaveBeenCalledTimes(1)
    expect(child.send).toHaveBeenCalledTimes(1)
  })

  it('retains a draft after factory failure and disposes an unadmitted child if the source changes during creation', async () => {
    const { ctx, service } = await harness()
    const agent = stub()
    prompt(agent, 'before')
    const edit = await service.beginEdit(agent)
    const create = vi.spyOn(ctx.agents, 'create').mockRejectedValueOnce(new Error('factory unavailable'))
    await expect(service.submitEdit(agent, edit.editId, 'corrected')).rejects.toThrow('factory unavailable')
    const child = stub(), dispose = vi.fn(async () => {})
    create.mockImplementationOnce(async () => {
      prompt(agent, 'racing prompt')
      return { agent: child, dispose }
    })
    await expect(service.submitEdit(agent, edit.editId, 'retry')).rejects.toThrow('stale')
    expect(child.send).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('returns clear errors for no prompt, a non-latest requested node, and invalid edit identity', async () => {
    const { service } = await harness()
    const agent = stub()
    await expect(service.beginEdit(agent)).rejects.toThrow('no user prompt')
    prompt(agent, 'one')
    const first = (await service.beginEdit(agent)).nodeId
    prompt(agent, 'two')
    await expect(service.beginEdit(agent, first)).rejects.toThrow('only the latest')
    await expect(service.submitEdit(agent, 'missing-edit', 'x')).rejects.toThrow('expired')
  })
})
