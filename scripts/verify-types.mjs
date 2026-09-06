#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = mkdtempSync(join(tmpdir(), 'dsh-session-tree-types-'))
const packageLink = join(fixture, 'node_modules/@deepseek-ai/dsh-session-tree')

try {
  mkdirSync(dirname(packageLink), { recursive: true })
  symlinkSync(root, packageLink, 'junction')
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  writeFileSync(join(fixture, 'consumer.ts'), `
import { apply as applyHost, inject as hostInject, name } from '@deepseek-ai/dsh-session-tree'
import { apply as applyClient, inject as clientInject } from '@deepseek-ai/dsh-session-tree/client'
import { apply as applyInvariant } from '@deepseek-ai/dsh-session-tree/invariant'
import { TYPERT } from '@deepseek-ai/dsh-session-tree/typert'
import remote from '@deepseek-ai/dsh-session-tree/remote'

const packageName: 'session-tree' = name
void [packageName, applyHost, hostInject, applyClient, clientInject, applyInvariant, TYPERT, remote]
`)
  writeFileSync(join(fixture, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      noEmit: true,
      skipLibCheck: false,
      strict: true,
    },
    files: ['consumer.ts'],
  }, undefined, 2))

  const tsc = resolve(root, 'node_modules/typescript/bin/tsc')
  const result = spawnSync(process.execPath, [tsc, '--project', join(fixture, 'tsconfig.json')], {
    cwd: fixture,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    throw new Error(`published declaration check failed with exit code ${String(result.status)}`)
  }
  process.stdout.write('standalone Bundle declaration consumer check passed\n')
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
