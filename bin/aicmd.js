#!/usr/bin/env node
/**
 * Runtime launcher for `aicmd` / `ai`.
 *
 * Preference order:
 *   1. Published build present (`dist/aicmd.js`, produced by `prepack`):
 *      import it. This is every installed copy - Node refuses to type-strip
 *      files inside node_modules, so installs must ship plain JavaScript.
 *   2. Development checkout without a build: import the TypeScript entry
 *      under Node's native type stripping (Node >= 22.18).
 *
 * This file stays plain JavaScript so it runs before any TypeScript support
 * is known to exist.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tsEntry = join(here, "aicmd.ts");
const distEntry = join(here, "..", "dist", "aicmd.js");

if (existsSync(distEntry)) {
  await import(pathToFileURL(distEntry).href);
} else {
  try {
    await import(pathToFileURL(tsEntry).href);
  } catch (err) {
    const code = err && typeof err === "object" ? err.code : undefined;
    if (code === "ERR_UNKNOWN_FILE_EXTENSION" || code === "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING") {
      process.stderr.write(
        [
          "aicmd could not start: this Node version cannot run TypeScript",
          "sources and no dist/ build is present. Fix one of:",
          "  - use Node >= 22.18 (native type stripping)",
          "  - run `pnpm run build` in the aicmd checkout to produce dist/",
          "",
        ].join("\n"),
      );
      process.exit(1);
    }
    throw err;
  }
}
