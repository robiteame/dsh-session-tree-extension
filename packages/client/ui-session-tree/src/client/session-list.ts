import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Read the main-view selection across current and 0.2 Session-list shapes. */
export function currentSessionId(state: SessionListState): SessionId | undefined {
  const legacy = (state as SessionListState & { current?: SessionId }).current
  if (legacy !== undefined) return legacy
  return state.ids
    .map(id => state.byId[id])
    .find(row => (row?.retainedBy.mainView ?? 0) > 0)?.id
}
