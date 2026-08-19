import { test, expect, describe } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const launcher = join(repoRoot, "bin", "aicmd.js");
const tsEntry = join(repoRoot, "bin", "aicmd.ts");

describe("entry points", () => {
  test("bun runs the TypeScript entry directly", () => {
    const result = spawnSync("bun", [tsEntry, "--version"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("the launcher resolves a runtime and reports the version", () => {
    const result = spawnSync("node", [launcher, "--version"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("--help documents the safety flags", () => {
    const result = spawnSync("bun", [tsEntry, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--execute");
    expect(result.stdout).toContain("--force");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--interactive");
  });

  test("a broken bun shim on PATH does not break the launcher", async () => {
    // Version managers leave `bun` shims that exist but exit non-zero when no
    // bun is installed; the launcher must treat those as "no bun" and fall
    // back to the dist bundle / type stripping.
    const { mkdtemp, writeFile, chmod, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const shimDir = await mkdtemp(join(tmpdir(), "aicmd-shim-"));
    try {
      const shim = join(shimDir, "bun");
      await writeFile(shim, "#!/bin/sh\necho 'no bun installed' >&2\nexit 1\n");
      await chmod(shim, 0o755);
      // Under `bun test`, process.execPath is bun - resolve the real node.
      const nodePath = spawnSync("which", ["node"], {
        encoding: "utf8",
      }).stdout.trim();
      const result = spawnSync(nodePath, [launcher, "--version"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${shimDir}:/usr/bin:/bin` },
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      await rm(shimDir, { recursive: true, force: true });
    }
  });
});
