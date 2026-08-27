/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-session-tree`.
 * @module @deepseek-ai/dsh-client-ui-session-tree/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-session-tree'

/** Cordis companion plugin name. */
export const name = 'client-ui-session-tree-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a single dock registration whose disposal is proven
 * by the HMR-safety spec — the panel owns no durable store, emits no cordis
 * events, and holds no cross-plugin mutable state beyond the live tree view
 * refreshed from the host Remote service.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
