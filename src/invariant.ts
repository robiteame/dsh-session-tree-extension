/** Bundle-level invariant companion; individual workspace packages own the detailed checks. */
export const name = 'session-tree-invariant'
export const inject = ['invariants']
export function apply(ctx: { invariants: { register: (name: string, install: () => void) => () => void } }): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-session-tree', () => {}))
}
