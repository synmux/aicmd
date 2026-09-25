/**
 * Configuration loading and merging.
 *
 * Precedence (low to high): built-in defaults < a global user config in
 * `$XDG_CONFIG_HOME/aicmd` (default `~/.config/aicmd`) < the nearest
 * `package.json` carrying an `aicmd` key (searched cwd → filesystem root) <
 * the nearest project `.aicmd.json` / `.aicmdrc(.json)` file (same search) <
 * CLI flags.
 *
 * File access goes through `node:fs/promises` rather than `Bun.file` so the
 * same code runs under Node when Bun is unavailable (a deliberate exception
 * to the repo's Bun-API preference; see AGENTS.md).
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { AicmdError } from "./errors.ts";
import type { Config, PartialConfig } from "./types.ts";
import { DEFAULT_SPINNER, isSpinnerName } from "./ui/spinner.ts";

export const DEFAULT_CONFIG: Config = {
  model: "sonnet",
  shell: null,
  interactive: false,
  interactiveCount: 3,
  interactiveTemperature: 1,
  spinner: DEFAULT_SPINNER,
  customPrompt: null,
  includeContext: true,
  showExplanation: true,
  dangerousPatterns: null,
  extraDangerousPatterns: [],
  allowApiKey: false,
};

const CONFIG_FILENAMES = [".aicmd.json", ".aicmdrc.json", ".aicmdrc"];

/**
 * Filenames accepted inside the global config directory, most-preferred first.
 * `config.json` is the canonical name (the directory already says which tool
 * it is for); the project-style names are also honoured so a config can be
 * copied or symlinked there. `config.json` is global-only — the project tree
 * walk never picks it up.
 */
const GLOBAL_CONFIG_FILENAMES = ["config.json", ...CONFIG_FILENAMES];

/**
 * The user-level config directory, `$XDG_CONFIG_HOME/aicmd` (falling back to
 * `~/.config/aicmd`). Per the XDG Base Directory spec, `XDG_CONFIG_HOME` is
 * honoured only when it is set to an absolute path.
 */
export function globalConfigDir(env: Record<string, string | undefined> = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
  return join(base, "aicmd");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

/** Read and parse a JSON file, `undefined` when it does not exist. */
async function readJsonIfExists(path: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    throw new AicmdError(`Failed to parse config file ${path}: ${(err as Error).message}`);
  }
}

/** The first existing global config file in {@link globalConfigDir}, if any. */
async function findGlobalConfigFile(env: Record<string, string | undefined>): Promise<string | undefined> {
  const dir = globalConfigDir(env);
  for (const name of GLOBAL_CONFIG_FILENAMES) {
    const candidate = join(dir, name);
    if (await fileExists(candidate)) return candidate;
  }
  return undefined;
}

/** Flat overlay of one partial config over another (no nested keys). */
export function mergePartial(base: PartialConfig, override: PartialConfig): PartialConfig {
  return { ...base, ...override };
}

/** Overlay a partial config onto a full config. */
export function mergeConfig(base: Config, override: PartialConfig): Config {
  return { ...base, ...override };
}

/** Coerce an unknown value to a string array, dropping non-string entries. */
function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Validate and normalize a parsed partial config, ignoring unknown keys. */
export function sanitizePartial(raw: unknown): PartialConfig {
  if (raw === null || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: PartialConfig = {};

  const bool = (key: "interactive" | "includeContext" | "showExplanation" | "allowApiKey") => {
    if (typeof obj[key] === "boolean") out[key] = obj[key] as boolean;
  };
  bool("interactive");
  bool("includeContext");
  bool("showExplanation");
  bool("allowApiKey");

  if (typeof obj.model === "string" && obj.model.trim() !== "") {
    out.model = obj.model;
  }
  if (typeof obj.shell === "string" && obj.shell.trim() !== "") {
    out.shell = obj.shell;
  } else if (obj.shell === null) {
    out.shell = null;
  }
  if (typeof obj.customPrompt === "string") out.customPrompt = obj.customPrompt;
  else if (obj.customPrompt === null) out.customPrompt = null;

  if (typeof obj.interactiveCount === "number" && Number.isFinite(obj.interactiveCount)) {
    out.interactiveCount = Math.max(1, Math.floor(obj.interactiveCount));
  }
  if (obj.interactiveTemperature === null) {
    out.interactiveTemperature = null;
  } else if (typeof obj.interactiveTemperature === "number" && Number.isFinite(obj.interactiveTemperature)) {
    out.interactiveTemperature = Math.min(2, Math.max(0, obj.interactiveTemperature));
  }
  if (typeof obj.spinner === "string" && isSpinnerName(obj.spinner)) {
    out.spinner = obj.spinner;
  }

  if (obj.dangerousPatterns === null) {
    out.dangerousPatterns = null;
  } else {
    const patterns = stringArray(obj.dangerousPatterns);
    if (patterns !== undefined) out.dangerousPatterns = patterns;
  }
  const extra = stringArray(obj.extraDangerousPatterns);
  if (extra !== undefined) out.extraDangerousPatterns = extra;

  return out;
}

export interface LoadFileConfigOptions {
  /** Explicit config file path; short-circuits project-file discovery. */
  configPath?: string;
  /** Environment supplying `XDG_CONFIG_HOME` (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
  /**
   * Directory at which the upward walks stop (inclusive). Defaults to the
   * filesystem root; tests pass a temp directory to keep discovery hermetic.
   */
  stopDir?: string;
}

/** Directories from `startDir` up to and including `stopDir` (or the fs root). */
function walkUp(startDir: string, stopDir: string | undefined): string[] {
  const dirs: string[] = [];
  let dir = resolve(startDir);
  const stop = stopDir !== undefined ? resolve(stopDir) : parse(dir).root;
  for (;;) {
    dirs.push(dir);
    if (dir === stop) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/** The first config file found walking `startDir` up to `stopDir`. */
async function findConfigFile(startDir: string, stopDir: string | undefined): Promise<string | undefined> {
  for (const dir of walkUp(startDir, stopDir)) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(dir, name);
      if (await fileExists(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * The `aicmd` object from the nearest package.json that carries one, walking
 * `startDir` up to `stopDir`. Malformed package.json files are skipped: the
 * file has many owners and its syntax errors are not aicmd's to enforce.
 */
async function findPackageJsonConfig(startDir: string, stopDir: string | undefined): Promise<unknown | undefined> {
  for (const dir of walkUp(startDir, stopDir)) {
    let pkg: unknown;
    try {
      pkg = await readJsonIfExists(join(dir, "package.json"));
    } catch {
      continue;
    }
    if (pkg !== undefined && typeof pkg === "object" && pkg !== null && "aicmd" in pkg) {
      return (pkg as Record<string, unknown>).aicmd;
    }
  }
  return undefined;
}

/**
 * Load and merge the file-based configuration layers that sit below CLI
 * flags, lowest first: the global user config, then the nearest
 * `package.json` `aicmd` key, then the nearest project config file (or the
 * explicit `configPath`, which short-circuits only the project-file
 * discovery — the layers beneath it still apply).
 */
export async function loadFileConfig(cwd: string, options: LoadFileConfigOptions = {}): Promise<PartialConfig> {
  const { configPath, env = process.env, stopDir } = options;
  let result: PartialConfig = {};

  // Global user config (lowest precedence). Like a project config file, a
  // malformed one throws: it is a file the user wrote deliberately.
  const globalPath = await findGlobalConfigFile(env);
  if (globalPath !== undefined) {
    result = mergePartial(result, sanitizePartial(await readJsonIfExists(globalPath)));
  }

  const pkgConfig = await findPackageJsonConfig(cwd, stopDir);
  if (pkgConfig !== undefined) {
    result = mergePartial(result, sanitizePartial(pkgConfig));
  }

  const filePath = configPath !== undefined ? resolve(cwd, configPath) : await findConfigFile(cwd, stopDir);
  if (filePath !== undefined) {
    const raw = await readJsonIfExists(filePath);
    if (raw === undefined && configPath !== undefined) {
      throw new AicmdError(`Config file not found: ${filePath}`);
    }
    result = mergePartial(result, sanitizePartial(raw));
  }

  return result;
}

/** Produce a fully-resolved config from file config and CLI-flag overrides. */
export function resolveConfig(fileConfig: PartialConfig, flagConfig: PartialConfig): Config {
  return mergeConfig(DEFAULT_CONFIG, mergePartial(fileConfig, flagConfig));
}
