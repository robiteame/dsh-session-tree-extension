/** Browser half of the session-tree extension: a right-details-sidebar panel. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import sessionTreeRemote from '@robiteame/dsh-pi-agent-session-tree/remote'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'command/executed'(sessionId: SessionId, name: string, result: CommandResult): void
  }
}
import type { SessionTreeForkView, SessionTreeView, TreeNode } from '@robiteame/dsh-pi-agent-session-tree/client'
import { nodeFullText } from './node-text.ts'
import { SessionForkLineage, browserForkLineageStorage, summarizeForkPrompt } from './fork-lineage.ts'
import type { SessionTreePanelActions } from './slots.ts'
import { SessionTreeDock } from './SessionTreePanel.tsx'
import { SessionBranchList } from './SessionBranchList.tsx'
import {
  SessionTreeOverlay,
  SessionTreeOverlayController,
  type SessionTreeRemoteActions,
} from './SessionTreeOverlay.tsx'
import { en, zh, type SessionTreeKey } from './locales.ts'

export { SessionTreePanel, SessionTreeDock } from './SessionTreePanel.tsx'
export { SessionTreeOverlay, SessionTreeOverlayController } from './SessionTreeOverlay.tsx'
export type { SessionTreeOverlayProps, SessionTreeOverlayState } from './SessionTreeOverlay.tsx'
export { SessionBranchList } from './SessionBranchList.tsx'
export { SessionForkLineage, summarizeForkPrompt } from './fork-lineage.ts'
export type { SessionBranchListProps } from './SessionBranchList.tsx'
export type { ForkLineageEntry, ForkLineageRecordInput, ForkLineageStorage } from './fork-lineage.ts'
export type { SessionTreePanelActions, SessionTreeViewProps } from './slots.ts'
export type { SessionTreeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'session-tree': SessionTreeKey }
}

const NS = 'session-tree'
export const inject = ['slots', 'sessions', 'conversation', 'remote', 'locale', 'layout']

/** Runtime-only editor face exposed by the native SessionInput shell. */
interface NativeSessionInput {
  readonly editor?: {
    parseEditorState(value: unknown): unknown
    setEditorState(state: unknown): void
  }
}

/** Build the serialized Lexical state used to seed one native composer. */
function editorStateForText(text: string): unknown {
  return {
    root: {
      children: text.split('\n').map(line => ({
        children: line === ''
          ? []
          : [{
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text: line,
              type: 'text',
              version: 1,
            }],
        direction: null,
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        type: 'paragraph',
        version: 1,
      })),
      direction: null,
      format: '',
      indent: 0,
      textFormat: 0,
      textStyle: '',
      type: 'root',
      version: 1,
    },
  }
}

/** Register UI only after the generated Remote namespace has been mounted. */
function registerSessionTreeUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-session-tree: dictionaries')
  const refreshers = new Map<SessionId, Set<() => void>>()
  ctx.effect(() => () => { refreshers.clear() }, 'ui-session-tree: refreshers')
  const overlay = new SessionTreeOverlayController()
  ctx.effect(() => () => { overlay.dispose() }, 'ui-session-tree: overlay state')
  // /fork presentation annotations for the left branch rail. The fork data and
  // the parent linkage stay owned by ctx.sessions.fork; only the /fork-vs-
  // /clone distinction and the rail summary live here.
  const forkLineage = new SessionForkLineage(browserForkLineageStorage())
  ctx.effect(() => () => { forkLineage.dispose() }, 'ui-session-tree: fork lineage')

  /** Write a fork prompt through the child Session's native editor instance. */
  const writeNativePrompt = (sessionId: SessionId, text: string): void => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error('fork child is not addressable')
    const input = ctx.conversation.input.for(binding.ctx) as unknown as NativeSessionInput
    const editor = input.editor
    if (editor === undefined) throw new Error('fork child native input editor is unavailable')
    editor.setEditorState(editor.parseEditorState(editorStateForText(text)))
  }

  /** Seed the new fork's native composer before revealing it. */
  const completeFork = (result: SessionTreeForkView): void => {
    if (result.sessionId === undefined) return
    if (result.prompt !== undefined) writeNativePrompt(result.sessionId, result.prompt)
    ctx.sessions.open(result.sessionId)
  }

  /** Fork through the same native session service used by the sidebar menu. */
  const forkNative = async (sessionId: SessionId, atSeq?: number): Promise<SessionId> => {
    return ctx.sessions.fork({
      sessionId,
      ...(atSeq === undefined ? {} : { atSeq }),
      increaseTitle: true,
    })
  }

  /** Fork and reveal a child without an editable prompt. */
  const openNativeFork = async (sessionId: SessionId, atSeq?: number): Promise<SessionId> => {
    const childId = await forkNative(sessionId, atSeq)
    ctx.sessions.open(childId)
    return childId
  }

  /**
   * Restore the native fork to the completed turn immediately before the
   * selected user message, then seed the child composer with that message.
   */
  const forkUserPrompt = async (sessionId: SessionId, node: TreeNode): Promise<void> => {
    const selectedSeq = node.metadata?.sessionEventSeq
    if (typeof selectedSeq !== 'number' || !Number.isSafeInteger(selectedSeq)) {
      throw new Error('selected user message has no native event sequence')
    }

    const source = ctx.sessions.binding(sessionId)
    if (source === undefined) throw new Error('source session is not addressable')

    // Ensure the source event window covers the selected node before looking
    // for the previous completed-turn boundary.
    await source.session.loadThrough(selectedSeq)
    const entries = source.eventSource.getSnapshot().entries
    let previousTurnEnd: number | undefined
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]
      if (
        entry?.type === 'event'
        && entry.event.type === 'turn/end'
        && entry.event.seq < selectedSeq
      ) {
        previousTurnEnd = entry.event.seq
        break
      }
    }

    if (previousTurnEnd === undefined) {
      throw new Error('The native fork API cannot fork before the first completed turn')
    }

    // `atSeq` is the first turn/end at or after the anchor. Passing the prior
    // completed turn therefore restores context strictly before the selection.
    const childId = await forkNative(sessionId, previousTurnEnd)
    forkLineage.record({
      childId,
      parentId: sessionId,
      summary: summarizeForkPrompt(nodeFullText(node)),
    })
    writeNativePrompt(childId, nodeFullText(node))
    ctx.sessions.open(childId)
    overlay.closeSelector()
  }

  const sendPrompt = async (sessionId: SessionId, text: string): Promise<void> => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error('session is not ready')
    const answered = await binding.session.prompt([{ type: 'text', text }], 'queue')
    if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
  }

  const remoteActions: SessionTreeRemoteActions = {
    load: async (sessionId) => {
      const answered = await ctx.remote.sessionTree.list(sessionId)
      if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
      return answered.value
    },
    jump: async (sessionId, nodeId) => {
      const answered = await ctx.remote.sessionTree.jump(sessionId, nodeId)
      if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
      return answered.value
    },
    fork: async (sessionId, nodeId, branch) => {
      const answered = await ctx.remote.sessionTree.forkSession(sessionId, nodeId, branch)
      if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
      if (answered.value.sessionId !== undefined) {
        forkLineage.record({
          childId: answered.value.sessionId,
          parentId: sessionId,
          ...(answered.value.prompt === undefined ? {} : { summary: summarizeForkPrompt(answered.value.prompt) }),
          branch,
        })
      }
      return answered.value
    },
    onRefresh: (sessionId, callback) => {
      const set = refreshers.get(sessionId) ?? new Set<() => void>()
      set.add(callback); refreshers.set(sessionId, set)
      return () => { set.delete(callback); if (set.size === 0) refreshers.delete(sessionId) }
    },
  }

  // Every supported official Web profile declares this additive root slot.
  // It remains a dormant fallback when the legacy source patch supplies the
  // richer named details-panel slot below.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'session-tree', order: 10, locale: NS,
    inject: () => ({
      controller: overlay,
      remoteActions,
      completeFork,
      forkUserPrompt,
      sendPrompt,
      openSession: (sessionId: SessionId) => { ctx.sessions.open(sessionId) },
    }),
  }, SessionTreeOverlay))

  // Second additive shell.overlay entry: the left-docked /fork branch rail.
  // It renders nothing until a /fork flow records a live branch, so ordinary
  // sessions and /clone children keep their original sidebar presentation.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'session-tree-branches', order: 11, locale: NS,
    inject: () => ({
      lineage: forkLineage,
      openSession: (sessionId: SessionId) => { ctx.sessions.open(sessionId) },
    }),
  }, SessionBranchList))

  // The legacy source patch owns this optional slot. Mirror its exact
  // declaration lifetime so HMR never shows both surfaces at once.
  ctx.slots.inject('conversation.details.panel' as never, () => {
    const disposePanel = ctx.slots.register({
      name: 'conversation.details.panel', id: 'session-tree', order: 10, locale: NS,
      inject: (sessionId: SessionId): SessionTreePanelActions => ({
        load: remoteActions.load,
        jump: nodeId => remoteActions.jump(sessionId, nodeId),
        fork: async (nodeId, branch) => {
          const result = await remoteActions.fork(sessionId, nodeId, branch)
          completeFork(result)
          return result
        },
        forkUserPrompt: node => forkUserPrompt(sessionId, node),
        modeController: overlay,
        onRefresh: callback => remoteActions.onRefresh(sessionId, callback),
      }),
    } as never, SessionTreeDock as never)
    overlay.setNativePanel(true)
    return () => {
      disposePanel()
      overlay.setNativePanel(false)
    }
  })

  ctx.on('command/executed', (sessionId: SessionId, name: string, result: CommandResult) => {
    if (name === 'tree') {
      if (overlay.getSnapshot().nativePanel) {
        (ctx.layout.openDetails as (panel?: string) => void)('session-tree')
      } else {
        overlay.open()
      }
    }
    if ((name === 'clone' || name === 'fork') && result.kind === 'success' && result.text !== undefined) {
      try {
        const payload = JSON.parse(result.text) as {
          value?: {
            sessionId?: string
            prompt?: string
            selectorRequired?: boolean
            nativeForkRequired?: boolean
          }
        }
        if (payload.value?.selectorRequired === true) {
          overlay.openSelector()
          // In the native details-dock profile, /fork must also make the dock
          // visible; the selector state alone only switches the overlay drawer.
          if (overlay.getSnapshot().nativePanel) {
            (ctx.layout.openDetails as (panel?: string) => void)('session-tree')
          }
        }
        else if (payload.value?.nativeForkRequired === true) {
          void openNativeFork(sessionId).catch(() => {
            // Match the sidebar action: a failed fork leaves the source open.
          })
        }
        else if (typeof payload.value?.sessionId === 'string') {
          const childId = payload.value.sessionId as SessionId
          forkLineage.record({
            childId,
            parentId: sessionId,
            ...(payload.value.prompt === undefined ? {} : { summary: summarizeForkPrompt(payload.value.prompt) }),
          })
          completeFork({
            cursor: '', branch: '', forkCount: 0,
            sessionId: childId,
            ...(payload.value.prompt === undefined ? {} : { prompt: payload.value.prompt }),
          })
        }
      } catch {
        // A non-JSON success is still a valid Host outcome; it simply has no navigable fork id.
      }
    }
    if (name === 'tree' || name === 'fork' || name === 'clone') {
      for (const refresh of refreshers.get(sessionId) ?? []) refresh()
    }
  })
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(sessionTreeRemote)
  // `remote.sessionTree` is created by $mount above. Cordis nested services must
  // be declared explicitly, so consume it from a child injection scope rather
  // than reading it from the outer scope that only injects `remote`.
  const ui = ctx.inject(
    ['slots', 'sessions', 'conversation', 'remote.sessionTree', 'locale', 'layout'],
    registerSessionTreeUi,
  )
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await unmountRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await unmountRemote()
  }
}

export type LoadedSessionTreeView = SessionTreeView
