#!/usr/bin/env node
/* Verify the four publishable packages: artifacts on disk, manifest shape, and pack contents. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

const PI = 'packages/extensions/pi-agent-session-tree'
const TOOL = 'packages/extensions/tool-session-tree'
const UI = 'packages/client/ui-session-tree'
const CARRIER = 'packages/bundle/session-tree'

const PI_NAME = '@robiteame/dsh-pi-agent-session-tree'
const TOOL_NAME = '@robiteame/dsh-tool-session-tree'
const UI_NAME = '@robiteame/dsh-client-ui-session-tree'
const CARRIER_NAME = '@robiteame/dsh-session-tree'

const checks = [
  {
    dir: PI, name: PI_NAME,
    files: [
      'package.json', 'README.md',
      'lib/index.js', 'lib/invariant.js',
      'lib/types/index.d.ts', 'lib/types/invariant.d.ts', 'lib/types/types.d.ts', 'lib/types/client.d.ts',
      'lib/typert.host.js', 'lib/typert.host.d.ts',
      'lib/typert.remote-client.js', 'lib/typert.remote-client.d.ts',
    ],
    markers: {
      'lib/index.js': ['SessionTreeService', 'sessionTreeSurfaceMode', 'selectMessageSurface', 'session-tree/snapshot'],
      'lib/typert.host.js': [`package: '${PI_NAME}'`, "method: 'jump'", "method: 'fork'", "method: 'list'", "method: 'session'"],
      'lib/typert.remote-client.js': [`package: '${PI_NAME}'`, "method: 'jump'", "method: 'fork'", "method: 'list'", "method: 'session'"],
    },
    manifest: {
      'dsh.bundle.patch': m => m.dsh?.bundle?.patch === undefined,
      peers: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-typert-protocol'],
      deps: ['zod'],
    },
  },
  {
    dir: TOOL, name: TOOL_NAME,
    files: [
      'package.json', 'README.md',
      'lib/index.js', 'lib/invariant.js', 'lib/types/index.d.ts', 'lib/types/invariant.d.ts',
    ],
    markers: {
      'lib/index.js': ['name: "session_tree"', 'name: "tree"', 'name: "fork"', 'name: "clone"', 'name: "session"', 'treeRestore', 'sessionTreeSurfaceMode'],
    },
    manifest: {
      'dsh.bundle.patch': m => m.dsh?.bundle?.patch === undefined,
      peers: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-commands', '@deepseek-ai/dsh-session', '@robiteame/dsh-pi-agent-session-tree'],
      deps: [],
    },
  },
  {
    dir: UI, name: UI_NAME,
    files: [
      'package.json', 'README.md',
      'lib/index.js', 'lib/invariant.js', 'lib/client.js', 'lib/types/index.d.ts', 'lib/types/client/index.d.ts',
    ],
    markers: {
      'lib/client.js': ['window.__ModuleLoader__.load({', `id: "${UI_NAME}"`, 'shell.overlay', 'data-session-tree-overlay', 'conversation.details.panel', 'sessionTree'],
    },
    manifest: {
      'dsh.bundle.patch': m => m.dsh?.bundle?.patch === undefined,
      'dsh.client.platform': m => m.dsh?.client?.platform === 'web',
      peers: ['@deepseek-ai/cordis'],
      deps: [],
    },
  },
  {
    dir: CARRIER, name: CARRIER_NAME,
    files: ['package.json', 'README.md', 'cordis.patch.yml'],
    markers: {
      'cordis.patch.yml': [`name: '${PI_NAME}'`, `name: '${TOOL_NAME}'`, `name: '${UI_NAME}'`],
    },
    manifest: {
      'dsh.bundle.patch': m => m.dsh?.bundle?.patch === './cordis.patch.yml',
      peers: [],
      deps: [PI_NAME, TOOL_NAME, UI_NAME],
    },
  },
]

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

// No workspace: protocol may survive anywhere under packages/.
for (const entry of readdirSync(resolve(root, 'packages'), { withFileTypes: true, recursive: true })) {
  if (entry.isFile() && entry.name === 'package.json' && !entry.parentPath.includes('node_modules')) {
    if (readFileSync(resolve(entry.parentPath, entry.name), 'utf8').includes('workspace:')) {
      fail(`${resolve(entry.parentPath, entry.name)} still references workspace:`)
    }
  }
}

for (const check of checks) {
  const dir = resolve(root, check.dir)
  const missing = check.files.filter(path => !existsSync(resolve(dir, path)))
  if (missing.length > 0) fail(`${check.name} is missing: ${missing.join(', ')}`)
  const manifest = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
  if (manifest.name !== check.name) fail(`${check.dir}: package.json name must be ${check.name}`)
  if (manifest.repository?.url !== 'git+https://github.com/robiteame/dsh-session-tree-extension.git') {
    fail(`${check.name}: repository.url must point at the plugin repository`)
  }
  if (manifest.publishConfig?.access !== 'public') fail(`${check.name}: publishConfig.access must be public`)
  for (const script of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'prepublishOnly']) {
    if (manifest.scripts?.[script] !== undefined) fail(`${check.name}: must not declare a ${script} lifecycle script`)
  }
  for (const peer of check.manifest.peers) {
    if (manifest.peerDependencies?.[peer] === undefined) fail(`${check.name}: missing peer ${peer}`)
    if (/workspace:/.test(manifest.peerDependencies[peer])) fail(`${check.name}: peer ${peer} uses workspace:`)
  }
  for (const dep of check.manifest.deps) {
    if (manifest.dependencies?.[dep] === undefined) fail(`${check.name}: missing dependency ${dep}`)
    if (/workspace:/.test(manifest.dependencies[dep])) fail(`${check.name}: dependency ${dep} uses workspace:`)
  }
  for (const [key, ok] of Object.entries(check.manifest).filter(([key]) => key.startsWith('dsh.'))) {
    if (!ok(manifest)) fail(`${check.name}: manifest check failed for ${key}`)
  }
  for (const [file, markers] of Object.entries(check.markers)) {
    const source = readFileSync(resolve(dir, file), 'utf8')
    for (const marker of markers) {
      if (!source.includes(marker)) fail(`${check.name}: ${file} is missing marker ${JSON.stringify(marker)}`)
    }
  }
  for (const file of check.files.filter(file => file.endsWith('.js'))) {
    const source = readFileSync(resolve(dir, file), 'utf8')
    if (source.includes(root)) fail(`${check.name}: ${file} leaks the build checkout path`)
  }
}

if (process.argv.includes('--pack')) {
  for (const check of checks) {
    const result = spawnSync('pnpm', ['pack', '--dry-run', '--json'], {
      cwd: resolve(root, check.dir),
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
    if (result.status !== 0) {
      process.stderr.write(result.stdout)
      process.stderr.write(result.stderr)
      fail(`pnpm pack --dry-run failed for ${check.name}`)
    }
    const jsonStart = result.stdout.indexOf('{')
    if (jsonStart < 0) fail(`pnpm pack --dry-run returned no JSON for ${check.name}`)
    const packed = JSON.parse(result.stdout.slice(jsonStart))
    const packedFiles = new Set(packed.files?.map(file => file.path))
    for (const path of check.files) {
      if (!packedFiles.has(path)) fail(`packed ${check.name} is missing ${path}`)
    }
    if (packedFiles.has('src')) fail(`packed ${check.name} must not ship source directories`)
    process.stdout.write(`packed ${check.name}: ${String(packedFiles.size)} files OK\n`)
  }
}
process.stdout.write('package artifact check passed\n')
