import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DEFAULT_CONFIG,
  globalConfigDir,
  loadFileConfig,
  mergeConfig,
  mergePartial,
  resolveConfig,
  sanitizePartial,
} from "../src/config.ts";

describe("sanitizePartial", () => {
  test("keeps known keys with correct types and drops the rest", () => {
    const out = sanitizePartial({
      model: "haiku",
      interactive: true,
      interactiveCount: 4.9,
      shell: "/usr/bin/fish",
      includeContext: false,
      showExplanation: "yes", // wrong type - ignored
      bogus: "nope",
    });
    expect(out.model).toBe("haiku");
    expect(out.interactive).toBe(true);
    expect(out.interactiveCount).toBe(4);
    expect(out.shell).toBe("/usr/bin/fish");
    expect(out.includeContext).toBe(false);
    expect(out.showExplanation).toBeUndefined();
    expect((out as Record<string, unknown>).bogus).toBeUndefined();
  });

  test("non-objects yield an empty config", () => {
    expect(sanitizePartial(null)).toEqual({});
    expect(sanitizePartial("x")).toEqual({});
    expect(sanitizePartial(42)).toEqual({});
  });

  test("shell and customPrompt accept explicit null", () => {
    expect(sanitizePartial({ shell: null }).shell).toBeNull();
    expect(sanitizePartial({ customPrompt: null }).customPrompt).toBeNull();
    expect(sanitizePartial({ customPrompt: "be terse" }).customPrompt).toBe("be terse");
  });

  test("interactiveTemperature accepts null, clamps to 0..2, ignores bad types", () => {
    expect(sanitizePartial({ interactiveTemperature: null }).interactiveTemperature).toBeNull();
    expect(sanitizePartial({ interactiveTemperature: 0.7 }).interactiveTemperature).toBe(0.7);
    expect(sanitizePartial({ interactiveTemperature: 9 }).interactiveTemperature).toBe(2);
    expect(sanitizePartial({ interactiveTemperature: -3 }).interactiveTemperature).toBe(0);
    expect(sanitizePartial({ interactiveTemperature: "hot" }).interactiveTemperature).toBeUndefined();
  });

  test("dangerousPatterns accepts null or a string array, filtering non-strings", () => {
    expect(sanitizePartial({ dangerousPatterns: null }).dangerousPatterns).toBeNull();
    expect(sanitizePartial({ dangerousPatterns: ["*rm *", 7, "re:x"] }).dangerousPatterns).toEqual(["*rm *", "re:x"]);
    expect(sanitizePartial({ dangerousPatterns: "x" }).dangerousPatterns).toBeUndefined();
  });

  test("extraDangerousPatterns accepts a string array only", () => {
    expect(sanitizePartial({ extraDangerousPatterns: ["*x*"] }).extraDangerousPatterns).toEqual(["*x*"]);
    expect(sanitizePartial({ extraDangerousPatterns: null }).extraDangerousPatterns).toBeUndefined();
  });

  test("unknown spinner names are dropped", () => {
    expect(sanitizePartial({ spinner: "dots" }).spinner).toBe("dots");
    expect(sanitizePartial({ spinner: "definitely-not-real" }).spinner).toBeUndefined();
  });
});

describe("defaults", () => {
  test("sensible safety-first defaults", () => {
    expect(DEFAULT_CONFIG.model).toBe("sonnet");
    expect(DEFAULT_CONFIG.interactive).toBe(false);
    expect(DEFAULT_CONFIG.allowApiKey).toBe(false);
    expect(DEFAULT_CONFIG.includeContext).toBe(true);
    expect(DEFAULT_CONFIG.showExplanation).toBe(true);
    expect(DEFAULT_CONFIG.dangerousPatterns).toBeNull();
    expect(DEFAULT_CONFIG.extraDangerousPatterns).toEqual([]);
    expect(DEFAULT_CONFIG.shell).toBeNull();
  });
});

describe("merge and precedence", () => {
  test("flags beat file config beat defaults", () => {
    const cfg = resolveConfig({ model: "haiku", interactive: true }, { interactive: false });
    expect(cfg.model).toBe("haiku"); // file
    expect(cfg.interactive).toBe(false); // flag overrides file
    expect(cfg.spinner).toBe(DEFAULT_CONFIG.spinner); // default
  });

  test("mergePartial is a flat overlay", () => {
    expect(mergePartial({ model: "a" }, { model: "b", interactive: true })).toEqual({
      model: "b",
      interactive: true,
    });
  });

  test("mergeConfig overlays partial keys onto a full config", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { model: "opus" });
    expect(merged.model).toBe("opus");
    expect(merged.interactiveCount).toBe(DEFAULT_CONFIG.interactiveCount);
  });
});

describe("loadFileConfig", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aicmd-config-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const load = (cwd: string, configPath?: string) =>
    loadFileConfig(cwd, {
      stopDir: dir,
      env: { XDG_CONFIG_HOME: join(dir, "empty-xdg") },
      ...(configPath !== undefined ? { configPath } : {}),
    });

  test("reads .aicmd.json", async () => {
    await writeFile(join(dir, ".aicmd.json"), JSON.stringify({ model: "haiku" }));
    expect((await load(dir)).model).toBe("haiku");
  });

  test("reads .aicmdrc.json and .aicmdrc", async () => {
    const nestedA = join(dir, "a");
    const nestedB = join(dir, "b");
    await mkdir(nestedA);
    await mkdir(nestedB);
    await writeFile(join(nestedA, ".aicmdrc.json"), JSON.stringify({ model: "opus" }));
    await writeFile(join(nestedB, ".aicmdrc"), JSON.stringify({ model: "haiku" }));
    expect((await load(nestedA)).model).toBe("opus");
    expect((await load(nestedB)).model).toBe("haiku");
  });

  test("walks up from cwd to stopDir to find a config", async () => {
    const nested = join(dir, "a", "b", "c");
    await mkdir(nested, { recursive: true });
    await writeFile(join(dir, ".aicmd.json"), JSON.stringify({ interactive: true }));
    expect((await load(nested)).interactive).toBe(true);
  });

  test("reads the aicmd key from the nearest package.json that has one", async () => {
    const nested = join(dir, "pkg", "src");
    await mkdir(nested, { recursive: true });
    // The nearest package.json has no aicmd key; the walk continues upward.
    await writeFile(join(dir, "pkg", "package.json"), JSON.stringify({ name: "x" }));
    await writeFile(join(dir, "package.json"), JSON.stringify({ aicmd: { model: "haiku" } }));
    expect((await load(nested)).model).toBe("haiku");
  });

  test("a dedicated config file overrides package.json", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ aicmd: { model: "haiku", interactive: true } }));
    await writeFile(join(dir, ".aicmd.json"), JSON.stringify({ model: "opus" }));
    const cfg = await load(dir);
    expect(cfg.model).toBe("opus"); // file wins
    expect(cfg.interactive).toBe(true); // package.json survives for other keys
  });

  test("a malformed package.json is skipped rather than fatal", async () => {
    await writeFile(join(dir, "package.json"), "{ not json ");
    await writeFile(join(dir, ".aicmd.json"), JSON.stringify({ model: "haiku" }));
    expect((await load(dir)).model).toBe("haiku");
  });

  test("a malformed dedicated config file throws", async () => {
    await writeFile(join(dir, ".aicmd.json"), "{ broken ");
    await expect(load(dir)).rejects.toThrow();
  });

  test("an explicit missing config path throws", async () => {
    await expect(load(dir, "nope.json")).rejects.toThrow();
  });

  test("an explicit config path short-circuits discovery", async () => {
    await writeFile(join(dir, ".aicmd.json"), JSON.stringify({ model: "opus" }));
    await writeFile(join(dir, "custom.json"), JSON.stringify({ model: "haiku" }));
    expect((await load(dir, join(dir, "custom.json"))).model).toBe("haiku");
  });
});

describe("global config (XDG)", () => {
  let projectDir: string;
  let xdgDir: string;
  const globalDir = () => join(xdgDir, "aicmd");

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "aicmd-project-"));
    xdgDir = await mkdtemp(join(tmpdir(), "aicmd-xdg-"));
    await mkdir(globalDir(), { recursive: true });
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
    await rm(xdgDir, { recursive: true, force: true });
  });

  const load = (configPath?: string) =>
    loadFileConfig(projectDir, {
      stopDir: projectDir,
      env: { XDG_CONFIG_HOME: xdgDir },
      ...(configPath !== undefined ? { configPath } : {}),
    });

  test("globalConfigDir honours an absolute XDG_CONFIG_HOME", () => {
    expect(globalConfigDir({ XDG_CONFIG_HOME: "/tmp/xdg" })).toBe("/tmp/xdg/aicmd");
  });

  test("globalConfigDir falls back to ~/.config when XDG is unset or relative", () => {
    expect(globalConfigDir({})).toMatch(/\.config\/aicmd$/);
    expect(globalConfigDir({ XDG_CONFIG_HOME: "relative/path" })).toMatch(/\.config\/aicmd$/);
  });

  test("reads config.json from the global directory", async () => {
    await writeFile(join(globalDir(), "config.json"), JSON.stringify({ model: "haiku" }));
    expect((await load()).model).toBe("haiku");
  });

  test("project config overrides the global config", async () => {
    await writeFile(join(globalDir(), "config.json"), JSON.stringify({ model: "haiku", interactive: true }));
    await writeFile(join(projectDir, ".aicmd.json"), JSON.stringify({ model: "opus" }));
    const cfg = await load();
    expect(cfg.model).toBe("opus");
    expect(cfg.interactive).toBe(true);
  });

  test("config.json is global-only - not discovered in the project tree", async () => {
    await writeFile(join(projectDir, "config.json"), JSON.stringify({ model: "haiku" }));
    expect((await load()).model).toBeUndefined();
  });

  test("a malformed global config throws", async () => {
    await writeFile(join(globalDir(), "config.json"), "{ broken ");
    await expect(load()).rejects.toThrow();
  });
});
