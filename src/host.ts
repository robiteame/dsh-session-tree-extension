/**
 * Standalone Bundle Host face.
 *
 * The two existing workspace extensions are imported from source and bundled
 * into this one entry. Keeping the domain and tool in the same output means
 * there is exactly one SessionTreeStore identity when the profile loads this
 * package from outside the Harness workspace.
 */
import type { Context } from '@deepseek-ai/cordis'
import SessionTreeService from '../packages/extensions/pi-agent-session-tree/src/index.ts'
import * as toolSessionTree from '../packages/extensions/tool-session-tree/src/index.ts'

/** Loader-facing namespace name. */
export const name = 'session-tree'
/** The command/tool registrations need these base services before applying. */
export const inject = ['tools', 'systemPrompt', 'commands', 'agents']

/** Mount the Remote service and the model-facing tool/command surface together. */
export function apply(ctx: Context): void {
  ctx.plugin(SessionTreeService)
  ctx.plugin(toolSessionTree)
}
