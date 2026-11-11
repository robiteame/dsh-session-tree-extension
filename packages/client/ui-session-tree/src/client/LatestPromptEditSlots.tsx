/** Native session slots shared by the browser and desktop conversation shell. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LatestPromptEditController } from './LatestPromptEditor.tsx'
import { LatestPromptEditButton, LatestPromptEditor } from './LatestPromptEditor.tsx'

type Injected = { controller: LatestPromptEditController }

export function LatestPromptEditButtonSlot({
  sessionId, controller, useSession, useAccess, t,
}: PropsRuntime<'conversation.input.right'> & PropsLocale<'session-tree'> & Injected) {
  const unavailable = useSession(state => state.removed || state.blank || state.subagent !== null || state.pendingSubmissions.length > 0)
  const canEdit = useAccess('sessionTree/beginEdit')
  const canSubmit = useAccess('sessionTree/submitEdit')
  return <LatestPromptEditButton sessionId={sessionId} controller={controller} t={t} disabled={unavailable || !canEdit || !canSubmit} />
}

export function LatestPromptEditorSlot({
  sessionId, controller, useSession, useAccess, t,
}: PropsRuntime<'conversation.input.dock'> & PropsLocale<'session-tree'> & Injected) {
  const unavailable = useSession(state => state.removed || state.subagent !== null || state.pendingSubmissions.length > 0)
  const canEdit = useAccess('sessionTree/beginEdit')
  const canSubmit = useAccess('sessionTree/submitEdit')
  return <LatestPromptEditor sessionId={sessionId} controller={controller} t={t} disabled={unavailable || !canEdit || !canSubmit} />
}
