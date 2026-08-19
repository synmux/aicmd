#!/usr/bin/env bun
/**
 * TypeScript entry point for `aicmd` / `ai`, used directly under Bun and
 * under Node with native type stripping. `bin/aicmd.js` is the runtime
 * launcher that picks how to reach this file.
 */
import { run } from '../src/cli.ts'
import { color } from '../src/ui/colors.ts'

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    // Unexpected (non-AicmdError) failures: print a stack for debugging.
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    process.stderr.write(`${color('31', 'unexpected error:')} ${detail}\n`)
    process.exitCode = 1
  })
