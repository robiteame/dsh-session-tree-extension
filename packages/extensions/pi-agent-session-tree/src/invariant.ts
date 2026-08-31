/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-pi-agent-session-tree`.
 * @module @deepseek-ai/dsh-pi-agent-session-tree/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-pi-agent-session-tree'

/** Cordis companion plugin name. */
export const name = 'pi-agent-session-tree-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No extra invariant: tree events pass through Session's canonical append and
 * persistence boundary, while immutable topology and versioned snapshots are
 * validated by the domain model itself.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
