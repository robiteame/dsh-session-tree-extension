export const name = 'session-tree-invariant'
export const inject = ['invariants']
export const apply = ctx => Promise.resolve(ctx.invariants.register("@deepseek-ai/dsh-session-tree", () => {}))
