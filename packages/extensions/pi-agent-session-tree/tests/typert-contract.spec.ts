import { describe, expect, it } from 'vitest'
import { TYPERT } from '../src/typert.host.template.js'
import TYPERT_REMOTE from '../src/typert.remote-client.template.js'

/**
 * The Typert artifacts are generated output frozen into the package. Harness
 * 0.2.1 replaced the generator's `codec.schema` shape with a `codec.create()`
 * factory plus an optional `jsonSchema` projection, and the release loader
 * rejects the old shape. These assertions pin the compatibility upgrade in the
 * templates so a future edit cannot silently ship a manifest the loader refuses.
 */
type Codec = {
  mode: string
  typeSymbol: string
  create?: () => unknown
  jsonSchema?: Record<string, unknown>
  schema?: unknown
}

type Invocation = {
  method: string
  parameters?: readonly { wire: string; codec: Codec; strictCodec?: Codec }[]
  result: Codec
}

function expectReleaseCodec(codec: Codec | undefined): void {
  expect(codec).toBeDefined()
  if (codec === undefined) return
  expect(codec.mode).toBe('strict')
  expect(typeof codec.typeSymbol).toBe('string')
  expect(typeof codec.create).toBe('function')
  expect(codec.schema).toBeUndefined()
  if (codec.jsonSchema !== undefined) expect(typeof codec.jsonSchema).toBe('object')
}

describe('Typert 0.2.1 artifact contract', () => {
  it('host invocations expose the release loader codec factory', () => {
    const invocations = (TYPERT as { invocations: Invocation[] }).invocations
    expect(invocations.length).toBeGreaterThan(0)
    for (const invocation of invocations) {
      for (const parameter of invocation.parameters ?? []) {
        expectReleaseCodec(parameter.codec)
        expectReleaseCodec(parameter.strictCodec)
      }
      expectReleaseCodec(invocation.result)
    }
  })

  it('remote artifact mounts every host endpoint through createTypertRemoteInfo', () => {
    const remote = TYPERT_REMOTE as {
      package: string
      methods: Record<string, { parameters?: readonly { wire: string; codec: Codec }[]; result: Codec }>
    }
    expect(remote.package).toBe('@robiteame/dsh-pi-agent-session-tree')
    expect(Object.keys(remote.methods).sort()).toStrictEqual([
      'sessionTree/beginEdit',
      'sessionTree/fork',
      'sessionTree/forkSession',
      'sessionTree/jump',
      'sessionTree/list',
      'sessionTree/session',
      'sessionTree/submitEdit',
    ])
    for (const method of Object.values(remote.methods)) {
      for (const parameter of method.parameters ?? []) expectReleaseCodec(parameter.codec)
      expectReleaseCodec(method.result)
    }
  })

  it('remote inputs parse the wire arguments the browser sends', () => {
    const remote = TYPERT_REMOTE as {
      methods: Record<string, { input: (options?: { strict?: boolean }) => { create: () => { safeParse: (value: unknown) => { success: boolean } } } }>
    }
    const fork = remote.methods['sessionTree/fork']!
    const parsed = fork.input().create().safeParse({ agentId: 'session-1', nodeId: 'node-1', branch: 'main' })
    expect(parsed.success).toBe(true)
    const rejected = fork.input().create().safeParse({ agentId: 'session-1', nodeId: 42, branch: 'main' })
    expect(rejected.success).toBe(false)
    const forkSession = remote.methods['sessionTree/forkSession']!.input({ strict: true }).create()
    const args = { agentId: 'session-1', nodeId: 'node-1', branch: 'fork' }
    expect(forkSession.safeParse(args).success).toBe(true)
    expect(forkSession.safeParse({ ...args, fromStart: true }).success).toBe(true)
    expect(forkSession.safeParse({ ...args, fromStart: 'true' }).success).toBe(false)
    const beginEdit = remote.methods['sessionTree/beginEdit']!.input({ strict: true }).create()
    expect(beginEdit.safeParse({ agentId: 'session-1' }).success).toBe(true)
    expect(beginEdit.safeParse({ agentId: 'session-1', nodeId: 'n1' }).success).toBe(true)
    expect(beginEdit.safeParse({ agentId: 'session-1', nodeId: 1 }).success).toBe(false)
    const submitEdit = remote.methods['sessionTree/submitEdit']!.input({ strict: true }).create()
    expect(submitEdit.safeParse({ agentId: 'session-1', editId: 'edit-1', prompt: 'corrected' }).success).toBe(true)
    expect(submitEdit.safeParse({ agentId: 'session-1', editId: 'edit-1', prompt: [] }).success).toBe(false)
    expect(submitEdit.safeParse({ agentId: 'session-1', prompt: 'missing edit id' }).success).toBe(false)
  })

  it('scopes both prompt editing endpoints to the addressed Agent for gateway access checks', () => {
    const invocations = (TYPERT as { invocations: Array<Invocation & { scope?: unknown }> }).invocations
    for (const method of ['beginEdit', 'submitEdit']) {
      const invocation = invocations.find(candidate => candidate.method === method)
      expect(invocation?.scope).toEqual({ context: 'agent', wire: 'agentId' })
      expect(invocation?.parameters?.[0]?.wire).toBe('agentId')
    }
  })
})
