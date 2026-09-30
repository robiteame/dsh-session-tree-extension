/** Native 0.2 right-Sidebar page body for the session tree. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionTreePanelActions } from './slots.ts'
import { SessionTreePanel } from './SessionTreePanel.tsx'

export type SessionTreeSidebarTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'session-tree'>
  & InjectFace<SessionTreePanelActions>

/**
 * Bind one right-Sidebar tab to the session it was opened in.
 * @param props - framework tab identity plus the session-tree action face.
 * @returns the same tree surface used by the legacy details dock.
 */
export function SessionTreeSidebarTab({
  useTabInfo,
  sessionId,
  useSessions,
  t,
  load,
  jump,
  jumpSession,
  select,
  fork,
  forkUserPrompt,
  modeController,
  onRefresh,
  lineage,
  openSession,
}: SessionTreeSidebarTabProps) {
  const tab = useTabInfo()
  return (
    <SessionTreePanel
      panel="session-tree"
      sessionId={sessionId as SessionId}
      useSessions={useSessions}
      t={t}
      load={load}
      jump={jump}
      {...(jumpSession === undefined ? {} : { jumpSession })}
      {...(select === undefined ? {} : { select })}
      fork={fork}
      {...(forkUserPrompt === undefined ? {} : { forkUserPrompt })}
      {...(modeController === undefined ? {} : { modeController })}
      {...(onRefresh === undefined ? {} : { onRefresh })}
      {...(lineage === undefined ? {} : { lineage })}
      {...(openSession === undefined ? {} : { openSession })}
      closeDetails={() => tab.tab.actions.close()}
    />
  )
}
