#!/usr/bin/env node
/**
 * Runtime launcher for `aicmd` / `ai`.
 *
 * Preference order:
 *   1. Already under Bun (bunx / bun x): import the TypeScript entry directly.
 *   2. Bun on PATH: re-spawn `bun bin/aicmd.ts` - Bun runs TypeScript natively
 *      and is the preferred runtime.
 *   3. Published build present: import `dist/aicmd.js` under Node (any
 *      supported Node version; no TypeScript involved).
 *   4. Development checkout without a build: import the TypeScript entry under
 *      Node's native type stripping (Node >= 22.18). Note Node refuses to
 *      strip types inside node_modules, which is why installed copies ship
 *      the dist build (step 3).
 *
 * This file stays plain JavaScript so every runtime can execute it as-is.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const tsEntry = join(here, 'aicmd.ts')
const distEntry = join(here, '..', 'dist', 'aicmd.js')
const args = process.argv.slice(2)

function bunOnPath() {
  // status must be checked too: version managers leave `bun` shims that
  // exist but fail when no bun is actually installed.
  const probe = spawnSync('bun', ['--version'], { stdio: 'ignore' })
  return probe.error === undefined && probe.status === 0
}

if (process.versions.bun) {
  await import(pathToFileURL(tsEntry).href)
} else if (bunOnPath()) {
  // Survive Ctrl-C while the child runs: the terminal delivers SIGINT to the
  // whole foreground group, and the child (which handles it in two stages)
  // must not be orphaned by its launcher dying first.
  const ignoreSigint = () => {}
  process.on('SIGINT', ignoreSigint)
  const result = spawnSync('bun', [tsEntry, ...args], { stdio: 'inherit' })
  process.off('SIGINT', ignoreSigint)
  if (result.signal) {
    // Re-raise the child's fatal signal so the parent shell sees the truth.
    process.kill(process.pid, result.signal)
  }
  process.exit(result.status ?? 1)
} else if (existsSync(distEntry)) {
  await import(pathToFileURL(distEntry).href)
} else {
  try {
    await import(pathToFileURL(tsEntry).href)
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : undefined
    if (code === 'ERR_UNKNOWN_FILE_EXTENSION' || code === 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING') {
      process.stderr.write(
        [
          'aicmd could not start: this Node version cannot run TypeScript',
          'sources and no dist/ build is present. Fix one of:',
          '  - install Bun (https://bun.sh); aicmd prefers it automatically',
          '  - use Node >= 22.18 (native type stripping)',
          '  - run `bun run build` in the aicmd checkout to produce dist/',
          ''
        ].join('\n')
      )
      process.exit(1)
    }
    throw err
  }
}
