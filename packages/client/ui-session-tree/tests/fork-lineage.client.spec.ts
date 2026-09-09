import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  SessionForkLineage,
  browserForkLineageStorage,
  summarizeForkPrompt,
  type ForkLineageStorage,
} from '../src/client/fork-lineage.ts'

const sid = (value: string): SessionId => value as SessionId

/** In-memory localStorage stand-in. */
function memoryStorage(): ForkLineageStorage & { dump(): string | null } {
  const store = new Map<string, string>()
  return {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value) },
    dump: () => store.get('session-tree.forkLineage.v1') ?? null,
  }
}

describe('session fork lineage store', () => {
  it('replaces the snapshot identity and notifies subscribers on record', () => {
    const lineage = new SessionForkLineage()
    const listener = vi.fn()
    lineage.subscribe(listener)
    const before = lineage.getSnapshot()
    lineage.record({ childId: sid('c1'), parentId: sid('s1'), summary: 'first' })
    const after = lineage.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.get(sid('c1'))).toMatchObject({ childId: sid('c1'), parentId: sid('s1'), summary: 'first' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('persists records and restores them through a new store', () => {
    const storage = memoryStorage()
    const writer = new SessionForkLineage(storage)
    writer.record({ childId: sid('c1'), parentId: sid('s1'), summary: 'first fork', branch: 'fork-a' })
    writer.record({ childId: sid('c2'), parentId: sid('s1') })
    expect(storage.dump()).not.toBeNull()

    const reader = new SessionForkLineage(storage)
    const restored = reader.getSnapshot()
    expect(restored.get(sid('c1'))).toMatchObject({ childId: sid('c1'), parentId: sid('s1'), summary: 'first fork', branch: 'fork-a' })
    expect(restored.get(sid('c2'))).toMatchObject({ childId: sid('c2'), parentId: sid('s1') })
    expect(restored.get(sid('c2'))?.summary).toBeUndefined()
  })

  it('drops empty annotations and tolerates hostile persisted payloads', () => {
    const storage = memoryStorage()
    storage.setItem('session-tree.forkLineage.v1', '{not json')
    expect(new SessionForkLineage(storage).getSnapshot().size).toBe(0)

    storage.setItem('session-tree.forkLineage.v1', JSON.stringify({ version: 2, entries: [] }))
    expect(new SessionForkLineage(storage).getSnapshot().size).toBe(0)

    storage.setItem('session-tree.forkLineage.v1', JSON.stringify({
      version: 1,
      entries: [
        { childId: 'ok', parentId: 'p' },
        null,
        { childId: 7, parentId: 'p' },
        { childId: 'no-parent' },
      ],
    }))
    const restored = new SessionForkLineage(storage).getSnapshot()
    expect([...restored.keys()]).toEqual([sid('ok')])

    const lineage = new SessionForkLineage(storage)
    lineage.record({ childId: sid('c'), parentId: sid('p'), summary: '', branch: '' })
    expect(lineage.getSnapshot().get(sid('c'))).toMatchObject({ childId: sid('c'), parentId: sid('p') })
    expect(lineage.getSnapshot().get(sid('c'))?.summary).toBeUndefined()
  })

  it('caps the registry at 500 entries, evicting the oldest first', () => {
    const lineage = new SessionForkLineage()
    for (let index = 0; index < 502; index++) {
      lineage.record({ childId: sid(`c${index}`), parentId: sid('s1'), createdAt: index })
    }
    const snapshot = lineage.getSnapshot()
    expect(snapshot.size).toBe(500)
    expect(snapshot.has(sid('c0'))).toBe(false)
    expect(snapshot.has(sid('c1'))).toBe(false)
    expect(snapshot.has(sid('c2'))).toBe(true)
    expect(snapshot.has(sid('c501'))).toBe(true)
  })

  it('clears annotations and detaches listeners on demand', () => {
    const lineage = new SessionForkLineage()
    const listener = vi.fn()
    const unsubscribe = lineage.subscribe(listener)
    lineage.record({ childId: sid('c1'), parentId: sid('s1') })
    unsubscribe()
    lineage.clear()
    expect(lineage.getSnapshot().size).toBe(0)
    expect(listener).toHaveBeenCalledTimes(1)

    lineage.record({ childId: sid('c2'), parentId: sid('s1') })
    lineage.dispose()
    expect(lineage.getSnapshot().size).toBe(1)
  })

  it('summarizes fork prompts into one short line', () => {
    expect(summarizeForkPrompt('  hello \n world  ')).toBe('hello world')
    expect(summarizeForkPrompt('short')).toBe('short')
    const long = 'x'.repeat(200)
    const summarized = summarizeForkPrompt(long)
    expect(summarized.length).toBe(96)
    expect(summarized.endsWith('…')).toBe(true)
    expect(summarizeForkPrompt('a'.repeat(96))).toBe('a'.repeat(96))
  })

  it('stays inert outside a browser window', () => {
    // The node test environment exposes no localStorage; the resolver must
    // return undefined rather than touching an undeclared global.
    expect(browserForkLineageStorage()).toBeUndefined()
  })
})
