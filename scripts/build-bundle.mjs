#!/usr/bin/env node
/* Build the standalone dual-face dsh Bundle without a Harness checkout. */
import { build } from 'esbuild'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = resolve(ROOT, 'lib')
const TEMP = resolve(ROOT, '.bundle-build')
const PACKAGE_NAME = '@deepseek-ai/dsh-session-tree'
const PI_PACKAGE_NAME = '@deepseek-ai/dsh-pi-agent-session-tree'

mkdirSync(LIB, { recursive: true })
mkdirSync(TEMP, { recursive: true })

const remoteTemplate = resolve(ROOT, 'src/typert.remote-client.template.js')
const hostTemplate = resolve(ROOT, 'src/typert.host.template.js')
if (!existsSync(remoteTemplate) || !existsSync(hostTemplate)) {
  throw new Error('missing Typert templates; run the repository setup task again')
}

const remoteArtifact = readFileSync(remoteTemplate, 'utf8').replaceAll(PI_PACKAGE_NAME, PACKAGE_NAME)
const hostArtifact = readFileSync(hostTemplate, 'utf8').replaceAll(PI_PACKAGE_NAME, PACKAGE_NAME)
writeFileSync(resolve(TEMP, 'typert.remote-client.js'), remoteArtifact)
writeFileSync(resolve(LIB, 'typert.remote-client.js'), remoteArtifact)
writeFileSync(resolve(LIB, 'typert.host.js'), hostArtifact)

const aliasPlugin = {
  name: 'dsh-session-tree-local-aliases',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@deepseek-ai\/dsh-pi-agent-session-tree(?:\/.*)?$/ }, args => {
      if (args.path.endsWith('/remote')) return { path: resolve(TEMP, 'typert.remote-client.js') }
      return { path: resolve(ROOT, 'packages/extensions/pi-agent-session-tree/src/index.ts') }
    })
  },
}

const cssPlugin = {
  name: 'dsh-session-tree-css-modules',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.module\.css$/ }, args => ({
      path: resolve(args.resolveDir, args.path),
      namespace: 'dsh-session-tree-css',
    }))
    pluginBuild.onLoad({ filter: /.*/, namespace: 'dsh-session-tree-css' }, args => {
      const source = readFileSync(args.path, 'utf8')
      const names = [...source.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)]
        .map(match => match[1])
        .filter(name => name !== undefined)
      const uniqueNames = [...new Set(names)]
      const classMap = Object.fromEntries(uniqueNames.map(name => [name, `dsh-tree_${name}`]))
      let css = source
      for (const name of uniqueNames) {
        css = css.replaceAll(`.${name}`, `.${classMap[name]}`)
      }
      const sourcePath = relative(ROOT, args.path).split(sep).join('/')
      const styleKey = `${PACKAGE_NAME}/${sourcePath}`
      const contents = [
        `const css = ${JSON.stringify(css)};`,
        `const id = ${JSON.stringify(styleKey)};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-dsh-session-tree-css="${styleKey}"]') === null) {`,
        "  const tag = document.createElement('style');",
        "  tag.dataset.dshSessionTreeCss = id;",
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
      return { contents, loader: 'js', resolveDir: dirname(args.path) }
    })
  },
}

const common = {
  bundle: true,
  target: 'es2022',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  absWorkingDir: ROOT,
}

await build({
  ...common,
  entryPoints: ['src/host.ts'],
  outfile: resolve(LIB, 'index.js'),
  platform: 'node',
  format: 'esm',
  external: ['@deepseek-ai/*', 'zod'],
  plugins: [aliasPlugin],
})

const clientCjs = resolve(TEMP, 'client.cjs')
await build({
  ...common,
  entryPoints: ['src/client.ts'],
  outfile: clientCjs,
  platform: 'browser',
  format: 'cjs',
  external: ['react', 'react/jsx-runtime'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [aliasPlugin, cssPlugin],
})

const clientBody = readFileSync(clientCjs, 'utf8')
const normalizedClientBody = clientBody.replaceAll(`${ROOT}${sep}`, '')
const clientWrapper = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(PACKAGE_NAME)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${normalizedClientBody.split('\n').map(line => `    ${line}`).join('\n')}\n    return module.exports;\n  }\n});\n`
writeFileSync(resolve(LIB, 'client.js'), clientWrapper)

writeFileSync(resolve(LIB, 'invariant.js'), `export const name = 'session-tree-invariant'\nexport const inject = ['invariants']\nexport const apply = ctx => Promise.resolve(ctx.invariants.register(${JSON.stringify(PACKAGE_NAME)}, () => {}))\n`)

mkdirSync(resolve(LIB, 'types'), { recursive: true })
// Copy the public declarations verbatim. Re-exporting a same-basename `.d.ts`
// from `lib/types` makes TypeScript strip the suffix and resolve the private
// `src/*.ts` implementation instead, which is not present in a consumer's
// package graph.
writeFileSync(resolve(LIB, 'types/index.d.ts'), readFileSync(resolve(ROOT, 'src/host.d.ts')))
writeFileSync(resolve(LIB, 'types/client.d.ts'), readFileSync(resolve(ROOT, 'src/client.d.ts')))
writeFileSync(resolve(LIB, 'types/invariant.d.ts'), `export declare const name: string\nexport declare const inject: readonly ['invariants']\nexport declare function apply(ctx: { invariants: { register(name: string, install: () => void): () => void } }): Promise<() => void>\n`)
writeFileSync(resolve(LIB, 'typert.host.d.ts'), `export declare const TYPERT: Record<string, unknown>\n`)
writeFileSync(resolve(LIB, 'typert.remote-client.d.ts'), `declare const TYPERT_REMOTE: Record<string, unknown>\nexport default TYPERT_REMOTE\n`)

if (process.argv.includes('--prepare')) {
  // Keep the prepare path deterministic and visible in pnpm logs. The actual
  // build above is intentionally run for Git and directory dependencies too.
  process.stdout.write('dsh-session-tree: standalone Bundle prepared\n')
}

rmSync(TEMP, { recursive: true, force: true })
