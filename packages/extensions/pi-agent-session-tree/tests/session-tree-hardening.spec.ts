import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  SessionTree,
  SessionTreeStore,
  type SessionTreeSnapshot,
  type TreeNode,
} from '@robiteame/dsh-pi-agent-session-tree'

const sid = (value: string): SessionId => value as SessionId
const ok = <T,>(result: { ok: boolean; value?: T; error?: { code: string } }): T => {
  expect(result.ok).toBe(true)
  return result.value!
}
const failed = (result: { ok: boolean; error?: { code: string } }, code: string): void => {
  expect(result.ok).toBe(false)
  expect(result.error?.code).toBe(code)
}

describe('SessionTree hardening', () => {
  it('clones active-path selections with fresh ids and drops unreachable selections safely', () => {
    const store = new SessionTreeStore()
    const source = store.create(sid('source'))
    const first = ok(source.append({ role: 'user', content: 'first' }))
    ok(source.append({ role: 'assistant', content: 'answer' }))
    ok(source.jump(first.nodeId))
    ok(source.append({ role: 'user', content: 'alternative' }))
    const alternative = source.cursor!
    ok(source.select(alternative))
    ok(source.jump(first.nodeId))

    expect(store.clone(sid('source'), sid('target')).ok).toBe(true)
    const unreachable = store.require(sid('target'))
    expect(unreachable.ok).toBe(true)
    const unreachableSnapshot = unreachable.ok ? unreachable.value.snapshot() : undefined
    expect(unreachableSnapshot?.nodes.map(node => node.summary)).toEqual(['first'])
    expect(unreachableSnapshot?.selectedNodeId).toBeNull()
    expect(unreachableSnapshot?.selectedNodeId).not.toBe(alternative)

    const selectedStore = new SessionTreeStore()
    const selectedSource = selectedStore.create(sid('selected-source'))
    const selectedFirst = ok(selectedSource.append({ role: 'user', content: 'first' }))
    ok(selectedSource.select(selectedFirst.nodeId))
    expect(selectedStore.clone(sid('selected-source'), sid('selected-target')).ok).toBe(true)
    const selectedTarget = selectedStore.require(sid('selected-target'))
    expect(selectedTarget.ok).toBe(true)
    const selectedSnapshot = selectedTarget.ok ? selectedTarget.value.snapshot() : undefined
    expect(selectedSnapshot?.selectedNodeId).toBe(selectedSnapshot?.cursor)
    expect(selectedSnapshot?.selectedNodeId).not.toBe(selectedFirst.nodeId)
    expect(selectedSnapshot?.nodes.some(node => node.nodeId === selectedSnapshot.selectedNodeId)).toBe(true)
  })

  it('rejects type-confused optional node and message fields in snapshots', () => {
    const base: SessionTreeSnapshot = {
      version: 1,
      sessionId: sid('s'),
      cursor: 'n1',
      activeBranch: 'main',
      branchHeads: { main: 'n1' },
      selectedNodeId: null,
      nodes: [{
        nodeId: 'n1',
        parentId: null,
        branch: 'main',
        summary: 'root',
        createdAt: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'root' },
      }],
    }
    const reject = (node: Partial<TreeNode>, message?: unknown): void => {
      const candidate = {
        ...base,
        nodes: [{ ...base.nodes[0], ...node, ...(message === undefined ? {} : { message }) }],
      } as unknown as SessionTreeSnapshot
      expect(() => new SessionTree(sid('s'), candidate)).toThrow('invalid session tree snapshot')
    }

    reject({ nodeId: '' })
    reject({ branch: '' })
    reject({ model: 42 as never })
    reject({ metadata: [] as never })
    reject({ metadata: { when: new Date() } as never })
    reject({}, { role: 'user', content: 'root', name: 7 })
    reject({}, { role: 'user', content: 'root', toolCallId: false })
  })

  it('rejects malformed append options before mutating the tree', () => {
    const tree = new SessionTree(sid('s'))
    const before = tree.snapshot()

    failed(tree.append({ role: 'user', content: 'ok' }, { metadata: null as never }), 'INVALID_ARGUMENT')
    failed(tree.append({ role: 'user', content: 'ok' }, { content: [{ type: 'text' }] as never }), 'INVALID_ARGUMENT')
    failed(tree.append({ role: 'user', content: 'ok' }, { content: 'text' as never }), 'INVALID_ARGUMENT')
    failed(tree.append({ role: 'user', content: 'ok' }, { metadata: { bad: 1n } as never }), 'INVALID_ARGUMENT')
    failed(tree.append({ role: 'user', content: 'ok' }, { usage: [] as never }), 'INVALID_ARGUMENT')
    failed(tree.append({ role: 'user', content: 'ok' }, { cost: Number.NaN }), 'INVALID_ARGUMENT')
    failed(tree.append({ role: 'user', content: 'ok' }, { model: 1 as never }), 'INVALID_ARGUMENT')
    failed(tree.append({ role: 'user', content: 'ok' }, { error: false as never }), 'INVALID_ARGUMENT')
    failed(tree.append({ role: 'user', content: 'ok', name: 1 as never }), 'INVALID_ARGUMENT')

    expect(tree.snapshot()).toEqual(before)
  })

  it('preserves append-only topology and snapshot equivalence under deterministic stress', () => {
    let state = 0x5eed1234
    const random = (): number => {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      return (state >>> 0) / 0x1_0000_0000
    }
    const tree = new SessionTree(sid('stress'))
    const known = new Map<string, TreeNode>()
    const assertInvariants = (): void => {
      const nodes = tree.list()
      expect(nodes.length).toBe(known.size)
      for (const node of nodes) {
        expect(known.get(node.nodeId)).toEqual(node)
        if (node.parentId !== null) expect(known.has(node.parentId)).toBe(true)
        const seen = new Set<string>()
        let current: TreeNode | undefined = node
        while (current !== undefined) {
          expect(seen.has(current.nodeId)).toBe(false)
          seen.add(current.nodeId)
          current = current.parentId === null ? undefined : known.get(current.parentId)
        }
      }
      const snapshot = tree.snapshot()
      const restored = new SessionTree(sid('stress'), snapshot)
      expect(restored.snapshot()).toEqual(snapshot)
      expect(restored.currentPath()).toEqual(tree.currentPath())
      expect(restored.messages()).toEqual(tree.messages())
    }

    for (let index = 0; index < 300; index++) {
      const nodes = [...known.values()]
      const action = nodes.length === 0 ? 0 : Math.floor(random() * 5)
      if (action === 0) {
        const node = ok(tree.append(
          { role: index % 3 === 0 ? 'user' : 'assistant', content: `turn-${index}` },
          { branch: index % 11 === 0 ? `branch-${index}` : undefined, metadata: { index } },
        ))
        known.set(node.nodeId, node)
      } else if (action === 1) {
        const target = nodes[Math.floor(random() * nodes.length)]!
        ok(tree.jump(target.nodeId))
      } else if (action === 2) {
        const target = nodes[Math.floor(random() * nodes.length)]!
        ok(tree.fork(target.nodeId, `fork-${index}`))
      } else if (action === 3) {
        const target = nodes[Math.floor(random() * nodes.length)]!
        ok(tree.select(target.nodeId))
      } else {
        const target = nodes[Math.floor(random() * nodes.length)]!
        const node = ok(tree.branchWithSummary(target.nodeId, `summary-${index}`))
        known.set(node.nodeId, node)
      }
      assertInvariants()
    }
  })
})
