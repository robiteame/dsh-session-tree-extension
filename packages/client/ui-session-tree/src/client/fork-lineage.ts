/**
 * UI-layer fork-lineage annotations for the left branch rail.
 *
 * The fork itself — and the durable parent linkage — always comes from the
 * official native session fork API: `ctx.sessions.fork()` writes the child into
 * the reactive Session list with `parentId`, and the rail reads that state for
 * topology and live updates. This registry stores only the presentation
 * metadata that state cannot know: which children were created by THIS
 * plugin's `/fork` flows (so `/clone` children and host-sidebar forks keep
 * their original display) and the short summary shown on the branch node.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One recorded `/fork` branch: display annotation plus its creation facts. */
export interface ForkLineageEntry {
  readonly childId: SessionId
  readonly parentId: SessionId
  /** Short single-line annotation for the branch node (the seeded fork prompt). */
  readonly summary?: string
  /** Branch label supplied by remote forks, when the creator named one. */
  readonly branch?: string
  /** Wall-clock creation time, used for stable child ordering. */
  readonly createdAt: number
}

/** Annotation input for {@link SessionForkLineage.record}. */
export type ForkLineageRecordInput = Omit<ForkLineageEntry, 'createdAt'> & { createdAt?: number }

/** Minimal persistence face (DOM localStorage in the browser, fakes in tests). */
export interface ForkLineageStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'session-tree.forkLineage.v1'
const MAX_ENTRIES = 500

/** Storage key the browser persistence writes under (exported for tests). */
export const FORK_LINEAGE_STORAGE_KEY = STORAGE_KEY

/** Collapse a seeded fork prompt into the short single-line rail annotation. */
export function summarizeForkPrompt(text: string, maxLength = 96): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  if (flat.length <= maxLength) return flat
  return `${flat.slice(0, maxLength - 1)}…`
}

/**
 * Insertion-ordered registry of `/fork` branches. The snapshot handed to
 * React is replaced (not mutated) on every record, so `useSyncExternalStore`
 * sees a new identity exactly when the lineage changed.
 */
export class SessionForkLineage {
  private readonly storage: ForkLineageStorage | undefined
  private snapshot: ReadonlyMap<SessionId, ForkLineageEntry> = new Map()
  private readonly listeners = new Set<() => void>()

  constructor(storage?: ForkLineageStorage) {
    this.storage = storage
    const raw = storage === undefined ? null : readStorage(storage)
    if (raw !== null) this.snapshot = raw
  }

  /** Stable store snapshot for `useSyncExternalStore`; identity changes on record only. */
  readonly getSnapshot = (): ReadonlyMap<SessionId, ForkLineageEntry> => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Record (or re-annotate) one `/fork` child and notify rail subscribers. */
  record(input: ForkLineageRecordInput): ForkLineageEntry {
    const entry: ForkLineageEntry = {
      childId: input.childId,
      parentId: input.parentId,
      ...(input.summary === undefined || input.summary === '' ? {} : { summary: input.summary }),
      ...(input.branch === undefined || input.branch === '' ? {} : { branch: input.branch }),
      createdAt: input.createdAt ?? Date.now(),
    }
    const next = new Map(this.snapshot)
    next.delete(entry.childId)
    next.set(entry.childId, entry)
    while (next.size > MAX_ENTRIES) {
      const oldest = next.keys().next()
      if (oldest.done === true) break
      next.delete(oldest.value)
    }
    this.snapshot = next
    this.persist()
    for (const listener of this.listeners) listener()
    return entry
  }

  /** Drop all annotations (test/teardown face; display is re-derived from state). */
  clear(): void {
    if (this.snapshot.size === 0) return
    this.snapshot = new Map()
    this.persist()
    for (const listener of this.listeners) listener()
  }

  dispose(): void {
    this.listeners.clear()
  }

  private persist(): void {
    if (this.storage === undefined) return
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1 as const,
        entries: [...this.snapshot.values()],
      }))
    } catch {
      // A full or unavailable storage quota only costs reload persistence.
    }
  }
}

/** Restore the persisted registry, rejecting foreign payload shapes. */
function readStorage(storage: ForkLineageStorage): ReadonlyMap<SessionId, ForkLineageEntry> | null {
  let parsed: unknown
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return null
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const version = (parsed as { version?: unknown }).version
  const entries = (parsed as { entries?: unknown }).entries
  if (version !== 1 || !Array.isArray(entries)) return null
  const restored = new Map<SessionId, ForkLineageEntry>()
  for (const candidate of entries) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const { childId, parentId } = candidate as { childId?: unknown; parentId?: unknown }
    if (typeof childId !== 'string' || typeof parentId !== 'string') continue
    const entry = candidate as ForkLineageEntry
    restored.set(childId as SessionId, {
      childId: childId as SessionId,
      parentId: parentId as SessionId,
      ...(typeof entry.summary === 'string' && entry.summary !== '' ? { summary: entry.summary } : {}),
      ...(typeof entry.branch === 'string' && entry.branch !== '' ? { branch: entry.branch } : {}),
      ...(typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? { createdAt: entry.createdAt } : { createdAt: 0 }),
    })
  }
  return restored
}

/** Resolve the browser localStorage lazily, staying inert outside the DOM. */
export function browserForkLineageStorage(): ForkLineageStorage | undefined {
  try {
    if (typeof localStorage !== 'object' || localStorage === null) return undefined
    return localStorage
  } catch {
    return undefined
  }
}
