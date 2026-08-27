/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-session-tree`.
 * @module @deepseek-ai/dsh-tool-session-tree/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-session-tree'

/** Cordis companion plugin name. */
export const name = 'tool-session-tree-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a tool and command registration whose disposal is
 * proven by the surface spec — the companion owns no durable store (all tree
 * state lives in the shared sessionTreeStore owned by the domain package).
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
