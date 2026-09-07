#!/usr/bin/env node
/* Build the three implementation packages standalone, without a Harness checkout. */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PI = resolve(ROOT, 'packages/extensions/pi-agent-session-tree')
const TOOL = resolve(ROOT, 'packages/extensions/tool-session-tree')
const UI = resolve(ROOT, 'packages/client/ui-session-tree')
const TEMP = resolve(ROOT, '.bundle-build')

const PI_NAME = '@robiteame/dsh-pi-agent-session-tree'
const UI_NAME = '@robiteame/dsh-client-ui-session-tree'

const requested = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const targets = requested.length > 0 ? requested : ['pi', 'tool', 'ui']

mkdirSync(TEMP, { recursive: true })

const hostExternal = ['@deepseek-ai/*', '@robiteame/*', 'zod']

const common = {
  bundle: true,
  target: 'es2022',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  absWorkingDir: ROOT,
}

/** Run one tsc declaration pass inside a package directory. */
function emitDeclarations(pkgDir) {
  const tsc = resolve(ROOT, 'node_modules/typescript/bin/tsc')
  if (!existsSync(tsc)) throw new Error('typescript is not installed; run pnpm install first')
  const result = spawnSync(process.execPath, [tsc, '--project', resolve(pkgDir, 'tsconfig.decl.json')], {
    cwd: pkgDir,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    throw new Error(`declaration build failed in ${relative(ROOT, pkgDir)}`)
  }
}

/** Bundle one node-side entry. */
async function buildHostEntry(entry, outfile, external = hostExternal) {
  await build({
    ...common,
    entryPoints: [entry],
    outfile,
    platform: 'node',
    format: 'esm',
    external,
  })
}

async function buildPi() {
  rmSync(resolve(PI, 'lib'), { recursive: true, force: true })
  await buildHostEntry(resolve(PI, 'src/index.ts'), resolve(PI, 'lib/index.js'))
  await buildHostEntry(resolve(PI, 'src/invariant.ts'), resolve(PI, 'lib/invariant.js'))
  // The Typert contracts are generator output frozen in-tree; the package name
  // inside them already matches this package, so they ship verbatim.
  writeFileSync(resolve(PI, 'lib/typert.host.js'), readFileSync(resolve(PI, 'src/typert.host.template.js'), 'utf8'))
  writeFileSync(resolve(PI, 'lib/typert.remote-client.js'), readFileSync(resolve(PI, 'src/typert.remote-client.template.js'), 'utf8'))
  writeFileSync(resolve(PI, 'lib/typert.host.d.ts'), `export declare const TYPERT: Record<string, unknown>\n`)
  writeFileSync(resolve(PI, 'lib/typert.remote-client.d.ts'), `declare const TYPERT_REMOTE: Record<string, unknown>\nexport default TYPERT_REMOTE\n`)
  emitDeclarations(PI)
}

async function buildTool() {
  rmSync(resolve(TOOL, 'lib'), { recursive: true, force: true })
  await buildHostEntry(resolve(TOOL, 'src/index.ts'), resolve(TOOL, 'lib/index.js'))
  await buildHostEntry(resolve(TOOL, 'src/invariant.ts'), resolve(TOOL, 'lib/invariant.js'))
  emitDeclarations(TOOL)
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
      const styleKey = `${UI_NAME}/${sourcePath}`
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

const remoteStubPlugin = {
  name: 'dsh-session-tree-remote-stub',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@robiteame\/dsh-pi-agent-session-tree\/remote$/ }, args => ({
      path: resolve(PI, 'src/typert.remote-client.template.js'),
    }))
  },
}

async function buildUi() {
  rmSync(resolve(UI, 'lib'), { recursive: true, force: true })
  await buildHostEntry(resolve(UI, 'src/index.ts'), resolve(UI, 'lib/index.js'), [...hostExternal, 'react', 'react-dom'])
  await buildHostEntry(resolve(UI, 'src/invariant.ts'), resolve(UI, 'lib/invariant.js'))
  emitDeclarations(UI)

  const clientCjs = resolve(TEMP, 'client.cjs')
  await build({
    ...common,
    entryPoints: [resolve(UI, 'src/client/index.ts')],
    outfile: clientCjs,
    platform: 'browser',
    format: 'cjs',
    external: ['react', 'react/jsx-runtime'],
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [remoteStubPlugin, cssPlugin],
  })

  const clientBody = readFileSync(clientCjs, 'utf8')
  const normalizedClientBody = clientBody.replaceAll(`${ROOT}${sep}`, '')
  const clientWrapper = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(UI_NAME)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${normalizedClientBody.split('\n').map(line => `    ${line}`).join('\n')}\n    return module.exports;\n  }\n});\n`
  writeFileSync(resolve(UI, 'lib/client.js'), clientWrapper)
}

for (const target of targets) {
  if (target === 'pi') await buildPi()
  else if (target === 'tool') await buildTool()
  else if (target === 'ui') await buildUi()
  else throw new Error(`unknown build target '${target}' (expected pi, tool, or ui)`)
}

rmSync(TEMP, { recursive: true, force: true })
process.stdout.write(`built: ${targets.join(', ')}\n`)
