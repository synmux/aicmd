import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * This package's version, read from the adjacent package.json at run time.
 *
 * A file read (rather than a JSON import) keeps the lookup working across
 * every execution mode: TypeScript sources under Bun or Node type-stripping
 * (`src/` → `../package.json`) and the bundled `dist/aicmd.js` build
 * (`dist/` → `../package.json`), without relying on JSON import-attribute
 * support in the host runtime.
 */
export function getVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "..", "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string") return parsed.version;
  } catch {
    /* fall through to the placeholder */
  }
  return "0.0.0";
}
