/** Native session slots shared by the browser and desktop conversation shell. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { LatestPromptEditController } from './LatestPromptEditor.tsx'
import { LatestPromptEditor } from './LatestPromptEditor.tsx'
import { LatestPromptBubbleAction } from './LatestPromptBubbleAction.tsx'
import { isInjectedUserSource } from './node-text.ts'

type Injected = { controller: LatestPromptEditController }

/** Read durable user messages, including steering, from the native Chat projection. */
function latestPrompt(snapshot: ChatSnapshot): ChatNode<'user' | 'steering'> | undefined {
  for (let index = snapshot.order.length - 1; index >= 0; index--) {
    const node = snapshot.nodes.get(snapshot.order[index]!)
    if (node?.kind !== 'user' && node?.kind !== 'steering') continue
    const prompt = node as ChatNode<'user' | 'steering'>
    if (!isInjectedUserSource(prompt.data.source)) return prompt
  }
  return undefined
}

export function LatestPromptEditorSlot({
  sessionId, controller, useSession, useChat, useAccess, t,
}: PropsRuntime<'conversation.input.dock'> & PropsLocale<'session-tree'> & Injected) {
  const unavailable = useSession(state => state.removed || state.blank || state.subagent !== null || state.pendingSubmissions.length > 0)
  const prompt = useChat(latestPrompt)
  const canEdit = useAccess('sessionTree/beginEdit')
  const canSubmit = useAccess('sessionTree/submitEdit')
  const disabled = unavailable || !canEdit || !canSubmit
  return <>
    {prompt === undefined ? null : <LatestPromptBubbleAction
      sessionId={sessionId}
      nodeKey={prompt.key}
      nodeId={`session-event-${prompt.data.seq}`}
      controller={controller}
      t={t}
      disabled={disabled}
    />}
    <LatestPromptEditor sessionId={sessionId} controller={controller} t={t} disabled={disabled} />
  </>
}
