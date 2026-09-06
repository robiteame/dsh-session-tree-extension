export declare const name: string
export declare const inject: readonly ['invariants']
export declare function apply(ctx: { invariants: { register(name: string, install: () => void): () => void } }): Promise<() => void>
