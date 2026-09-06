#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageName = '@deepseek-ai/dsh-session-tree'
const required = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/client.js',
  'lib/invariant.js',
  'lib/typert.host.js',
  'lib/typert.host.d.ts',
  'lib/typert.remote-client.js',
  'lib/typert.remote-client.d.ts',
  'lib/types/index.d.ts',
  'lib/types/client.d.ts',
  'lib/types/invariant.d.ts',
]
const missing = required.filter(path => !existsSync(resolve(root, path)))
if (missing.length > 0) throw new Error(`standalone Bundle is missing: ${missing.join(', ')}`)
const manifestSource = readFileSync(resolve(root, 'package.json'), 'utf8')
const manifest = JSON.parse(manifestSource)
if (manifest.name !== packageName) throw new Error(`package.json name must be ${packageName}`)
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('package.json dsh.bundle.patch is incorrect')
if (manifest.dsh?.client?.platform !== 'web') throw new Error('package.json dsh.client.platform must be web')
if (manifestSource.includes('workspace:')) {
  throw new Error('root package.json must not use workspace: dependencies outside the Harness workspace')
}
for (const subpath of ['.', './client', './typert', './remote', './invariant']) {
  if (manifest.exports?.[subpath] === undefined) throw new Error(`package.json is missing export ${subpath}`)
}
for (const path of ['lib/types/index.d.ts', 'lib/types/client.d.ts']) {
  const declaration = readFileSync(resolve(root, path), 'utf8')
  if (declaration.includes('/src/') || declaration.includes('../src')) {
    throw new Error(`${path} must not resolve through unpublished source declarations`)
  }
}
const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
if (!patch.includes('id: session-tree') || !patch.includes(`name: '${packageName}'`)) {
  throw new Error('cordis.patch.yml does not mount the standalone package')
}

const host = readFileSync(resolve(root, 'lib/index.js'), 'utf8')
for (const marker of [
  'SessionTreeService',
  'SessionTreeSidecar',
  'name: "session_tree"',
  'name: "tree"',
  'name: "fork"',
  'name: "clone"',
  'name: "session"',
  'treeRestore',
  'storages',
  'session-tree',
]) {
  if (!host.includes(marker)) throw new Error(`Host artifact is missing ${marker}`)
}

const client = readFileSync(resolve(root, 'lib/client.js'), 'utf8')
for (const marker of [
  'window.__ModuleLoader__.load({',
  `id: "${packageName}"`,
  'shell.overlay',
  'data-session-tree-overlay',
  'conversation.details.panel',
  'sessionTree',
]) {
  if (!client.includes(marker)) throw new Error(`WebUI artifact is missing ${marker}`)
}

const generatedArtifacts = [
  'lib/index.js',
  'lib/client.js',
  'lib/invariant.js',
  'lib/typert.host.js',
  'lib/typert.remote-client.js',
]
for (const path of generatedArtifacts) {
  const source = readFileSync(resolve(root, path), 'utf8')
  if (source.includes(root)) throw new Error(`${path} leaks the build checkout path`)
}
for (const path of ['lib/typert.host.js', 'lib/typert.remote-client.js']) {
  const source = readFileSync(resolve(root, path), 'utf8')
  if (!source.includes(`package: '${packageName}'`)) throw new Error(`${path} has the wrong package identity`)
  for (const method of ['fork', 'jump', 'list', 'session']) {
    if (!source.includes(`method: '${method}'`)) throw new Error(`${path} is missing the ${method} Remote descriptor`)
  }
}

if (process.argv.includes('--pack')) {
  const result = spawnSync('pnpm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    throw new Error(`pnpm pack --dry-run failed with exit code ${String(result.status)}`)
  }
  const jsonStart = result.stdout.indexOf('{')
  if (jsonStart < 0) throw new Error('pnpm pack --dry-run did not return JSON metadata')
  const packed = JSON.parse(result.stdout.slice(jsonStart))
  const packedFiles = new Set(packed.files?.map(file => file.path))
  for (const path of required) {
    if (!packedFiles.has(path)) throw new Error(`packed Bundle is missing ${path}`)
  }
  process.stdout.write(`packed Bundle artifact check passed (${String(packedFiles.size)} files)\n`)
}
process.stdout.write('standalone Bundle artifact check passed\n')
