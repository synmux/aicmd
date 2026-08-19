/**
 * The platform/shell context block injected into the generation prompt so the
 * model writes commands that fit this machine — the BSD-vs-GNU userland split
 * and non-POSIX shells being the two classic failure modes.
 */
import {
  arch as osArch,
  platform as osPlatform,
  release as osRelease,
} from "node:os";
import { basename } from "node:path";
import type { Config } from "./types.ts";

/**
 * The shell the command targets: config wins, then `$SHELL`, then `/bin/sh`.
 * An empty `$SHELL` counts as unset.
 */
export function resolveShell(
  configShell: string | null,
  env: Record<string, string | undefined> = process.env,
): string {
  return configShell || env.SHELL || "/bin/sh";
}

/** The bare shell name from a shell path (`/opt/homebrew/bin/fish` → `fish`). */
export function shellName(shellPath: string): string {
  return basename(shellPath);
}

export interface ContextInfo {
  platform: string;
  release: string;
  arch: string;
  shellPath: string;
}

function platformLine(info: ContextInfo): string {
  switch (info.platform) {
    case "darwin":
      return (
        `Platform: macOS (darwin ${info.release}, ${info.arch}). ` +
        "The userland is BSD, not GNU: sed, date, stat, find and friends take " +
        "different flags here (e.g. `sed -i ''`, `date -v-1d`)."
      );
    case "linux":
      return `Platform: Linux (kernel ${info.release}, ${info.arch}), GNU userland.`;
    case "win32":
      return `Platform: Windows (${info.release}, ${info.arch}).`;
    default:
      return `Platform: ${info.platform} (${info.release}, ${info.arch}).`;
  }
}

function shellLine(info: ContextInfo): string {
  const name = shellName(info.shellPath);
  let line = `Target shell: ${name} (${info.shellPath}); the command will be executed with \`${name} -c\`.`;
  if (name === "fish") {
    line +=
      " Use fish syntax where it differs from POSIX (e.g. `set -x VAR value` " +
      "instead of `export`, `(cmd)` for command substitution).";
  }
  return line;
}

/** Build the context block from explicit values (injectable for tests). */
export function buildContextBlock(info: ContextInfo): string {
  return [platformLine(info), shellLine(info)].join("\n");
}

/**
 * The context block for the current machine, or `null` when the config
 * disables context injection.
 */
export function gatherContext(
  config: Pick<Config, "includeContext" | "shell">,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!config.includeContext) return null;
  return buildContextBlock({
    platform: osPlatform(),
    release: osRelease(),
    arch: osArch(),
    shellPath: resolveShell(config.shell, env),
  });
}
