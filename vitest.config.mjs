import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const fromRoot = relativePath => fileURLToPath(new URL(relativePath, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@deepseek-ai\/dsh-pi-agent-session-tree\/remote$/u,
        replacement: fromRoot('./lib/typert.remote-client.js'),
      },
      {
        find: /^@deepseek-ai\/dsh-pi-agent-session-tree\/client$/u,
        replacement: fromRoot('./packages/extensions/pi-agent-session-tree/src/client.ts'),
      },
      {
        find: /^@deepseek-ai\/dsh-pi-agent-session-tree$/u,
        replacement: fromRoot('./packages/extensions/pi-agent-session-tree/src/index.ts'),
      },
      {
        find: /^@deepseek-ai\/dsh-tool-session-tree$/u,
        replacement: fromRoot('./packages/extensions/tool-session-tree/src/index.ts'),
      },
    ],
  },
  esbuild: {
    // This standalone extension repository keeps upstream Harness tsconfig
    // project references for source parity, but those referenced monorepo
    // directories do not exist here. Supplying a string tsconfigRaw makes Vite
    // skip loading/following those missing project references during tests.
    tsconfigRaw: JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        allowImportingTsExtensions: true,
        jsx: 'react-jsx',
      },
    }),
  },
})
