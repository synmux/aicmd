#!/usr/bin/env node
/**
 * TypeScript entry point for `aicmd` / `ai`, run under Node's native type
 * stripping in a checkout and bundled into `dist/aicmd.js` for installs.
 * `bin/aicmd.js` is the runtime launcher that picks how to reach this file.
 */
import { run } from "../src/cli.ts";
import { color } from "../src/ui/colors.ts";

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    // Unexpected (non-AicmdError) failures: print a stack for debugging.
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${color("31", "unexpected error:")} ${detail}\n`);
    process.exitCode = 1;
  });
