import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const launcher = join(repoRoot, "bin", "aicmd.js");
const tsEntry = join(repoRoot, "bin", "aicmd.ts");

describe("entry points", () => {
  test("node runs the TypeScript entry directly (native type stripping)", () => {
    const result = spawnSync(process.execPath, [tsEntry, "--version"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("the launcher resolves an entry and reports the version", () => {
    const result = spawnSync(process.execPath, [launcher, "--version"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("--help documents the safety flags", () => {
    const result = spawnSync(process.execPath, [tsEntry, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--execute");
    expect(result.stdout).toContain("--force");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--interactive");
  });
});
