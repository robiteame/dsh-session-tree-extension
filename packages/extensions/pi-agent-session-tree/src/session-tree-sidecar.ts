/**
 * Plugin-owned durable sidecar for SessionTree projections.
 *
 * The stock DeepSeek-Harness session log does not recognize `session-tree/*`
 * events, so branch names, cursor, selection, and explicit snapshot state
 * cannot live inside `session.jsonl.zstd` without patching the harness. This
 * module keeps one small JSON artifact per session under the DSH home instead
 * and replays only native events after the stored watermark on resume.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionTree } from './session-tree.ts'
import type { SessionTreeSnapshot } from './types.ts'

const SIDECAR_VERSION = 1

/** One sidecar artifact: versioned ownership plus the latest tree snapshot. */
interface SessionTreeSidecarRecord {
  readonly version: typeof SIDECAR_VERSION
  readonly sessionId: string
  readonly savedAt: number
  readonly snapshot: SessionTreeSnapshot
}

/** Resolve the DSH-owned sidecar directory. */
function defaultSidecarRoot(): string {
  const home = process.env.DSH_HOME ?? process.env.HOME ?? '.'
  return join(home, 'storages', 'session-tree')
}

/** Make a session id safe as a filename without losing its diagnostic shape. */
function sidecarFilename(sessionId: SessionId): string {
  return `${sessionId.replaceAll(/[^A-Za-z0-9._-]/g, '_')}.json`
}

/** Synchronous sidecar store used by host-only session-tree plugins. */
export class SessionTreeSidecar {
  constructor(readonly root: string = defaultSidecarRoot()) {}

  /** Read and validate the latest snapshot for one session. */
  load(sessionId: SessionId): SessionTree | undefined {
    const path = join(this.root, sidecarFilename(sessionId))
    if (!existsSync(path)) return undefined
    try {
      const record = JSON.parse(readFileSync(path, 'utf8')) as Partial<SessionTreeSidecarRecord>
      if (record.version !== SIDECAR_VERSION
        || record.sessionId !== sessionId
        || typeof record.savedAt !== 'number'
        || record.snapshot === undefined) {
        return undefined
      }
      return new SessionTree(sessionId, record.snapshot)
    } catch {
      return undefined
    }
  }

  /**
   * Atomically persist one tree. I/O errors are deliberately contained:
   * the native Session log remains the source of truth and can rebuild a
   * linear projection even when the sidecar directory is unavailable.
   */
  save(sessionId: SessionId, tree: SessionTree): boolean {
    const record: SessionTreeSidecarRecord = {
      version: SIDECAR_VERSION,
      sessionId,
      savedAt: Date.now(),
      snapshot: tree.snapshot(),
    }
    const path = join(this.root, sidecarFilename(sessionId))
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
      renameSync(temporary, path)
      return true
    } catch {
      try { rmSync(temporary, { force: true }) } catch { /* best effort cleanup */ }
      return false
    }
  }
}

/** Process-wide sidecar selected by the Host Bundle or a test. */
let activeSidecar = new SessionTreeSidecar()

export function getSessionTreeSidecar(): SessionTreeSidecar {
  return activeSidecar
}

/** Replace the active sidecar, primarily for isolated tests. */
export function setSessionTreeSidecar(sidecar: SessionTreeSidecar): void {
  activeSidecar = sidecar
}

/** Persist one tree without coupling callers to the active store selection. */
export function persistSessionTree(tree: SessionTree): boolean {
  return activeSidecar.save(tree.sessionId, tree)
}
