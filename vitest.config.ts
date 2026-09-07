import ts from 'typescript'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/**
 * Transpile standard TypeScript decorators before Vite's oxc parser sees the
 * source. Mirrors the Harness repository's own vitest.shared.ts plugin so the
 * Remote decorators keep their standard semantics under test.
 */
function standardDecoratorPlugin() {
  return {
    name: 'dsh-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText
          .replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

/**
 * Standalone host-half test runner. The specs import the sibling packages by
 * name, so alias every used specifier to its source tree; the @deepseek-ai
 * peers resolve from the installed published packages. The browser spec in
 * packages/client/ui-session-tree needs the Harness client test runtime and
 * keeps running inside a Harness checkout (see the dev/ source-integration
 * flow).
 */
export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  resolve: {
    alias: [
      { find: '@robiteame/dsh-pi-agent-session-tree/client', replacement: `${root}packages/extensions/pi-agent-session-tree/src/client` },
      { find: '@robiteame/dsh-pi-agent-session-tree', replacement: `${root}packages/extensions/pi-agent-session-tree/src/index` },
      { find: '@robiteame/dsh-tool-session-tree', replacement: `${root}packages/extensions/tool-session-tree/src/index` },
    ],
  },
  test: {
    environment: 'node',
    include: ['packages/extensions/**/tests/**/*.spec.ts'],
  },
})
