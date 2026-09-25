/**
 * Dangerous-command detection.
 *
 * Two independent signals are combined:
 *
 * 1. Local guard patterns matched against the command text. Plain patterns
 *    are fish-style whole-string globs (`*` matches anything) for direct
 *    parity with `string match` guard lists; the `re:` prefix switches the
 *    remainder to a regular expression for precision. Both are matched
 *    case-insensitively.
 * 2. The model's own `dangerous` flag from structured output, which covers
 *    everything a static pattern list cannot know about.
 */
import { AicmdError } from "./errors.ts";
import type { DangerAssessment, GeneratedCommand } from "./types.ts";

/**
 * Built-in guard patterns with human-readable labels for warnings. Mostly
 * `re:` regexes for precision (a bare `*rm *` glob would flag
 * `echo confirm this`).
 */
const DEFAULT_PATTERN_TABLE: ReadonlyArray<{ pattern: string; label: string }> = [
  // File destruction: rm as a command token anywhere in a pipeline, with an
  // optional path prefix (/bin/rm) or the \rm alias-bypass idiom.
  {
    pattern: "re:(?:^|[|;&(\\s])(?:\\\\|[\\w/.-]*/)?rm(?:\\s|$)",
    label: "file deletion (rm)",
  },
  { pattern: "re:\\bshred\\b", label: "secure file destruction (shred)" },
  {
    pattern: "re:\\bmv\\b.*\\s/dev/null",
    label: "discarding a file into /dev/null",
  },
  {
    pattern: "re:\\bfind\\b.*\\s-delete\\b",
    label: "mass deletion (find -delete)",
  },
  {
    pattern: "re:\\brsync\\b.*\\s--delete\\b",
    label: "destination pruning (rsync --delete)",
  },
  {
    pattern: "re:\\btruncate\\b.*\\s-s\\s*0\\b",
    label: "emptying a file (truncate -s 0)",
  },
  {
    pattern: "re:\\bcrontab\\b\\s+-r\\b",
    label: "wiping the crontab (crontab -r)",
  },
  // Permission/ownership sweeps.
  {
    pattern: "re:chmod\\s.*777",
    label: "world-writable permissions (chmod 777)",
  },
  {
    pattern: "re:chown\\s+-[a-zA-Z]*R",
    label: "recursive ownership change (chown -R)",
  },
  // Raw-device writes and (re)formatting.
  {
    pattern: "re:>\\s*/dev/(?:sd|disk|nvme|hd)",
    label: "writing to a raw disk device",
  },
  { pattern: "re:\\bdd\\b.*\\bof=/dev/", label: "dd onto a device" },
  { pattern: "re:\\bmkfs", label: "filesystem creation (mkfs)" },
  { pattern: "re:\\bfdisk\\b", label: "partition editing (fdisk)" },
  {
    pattern: "re:diskutil\\s+(?:erase|partition|reformat|zero)",
    label: "disk erasure (diskutil)",
  },
  // The classic fork bomb (and close variants).
  { pattern: "re::\\(\\)\\s*\\{", label: "fork bomb" },
  // Piping remote content into a shell.
  {
    pattern: "re:\\b(?:curl|wget)\\b.*\\|\\s*(?:sudo\\s+)?(?:ba|z|da|fi)?sh\\b",
    label: "piping a download into a shell",
  },
  // Host state.
  {
    pattern: "re:\\b(?:shutdown|reboot|halt|poweroff)\\b",
    label: "host shutdown/reboot",
  },
  // History-destroying git.
  {
    pattern: "re:git\\s+push\\b.*\\s(?:--force(?:-with-lease)?|-f)\\b",
    label: "git force-push",
  },
  { pattern: "re:git\\s+reset\\s+--hard", label: "git hard reset" },
  { pattern: "re:git\\s+clean\\b.*\\s-[a-zA-Z]*f", label: "git clean -f" },
];

export const DEFAULT_DANGEROUS_PATTERNS: readonly string[] = DEFAULT_PATTERN_TABLE.map((entry) => entry.pattern);

/** Human label for a built-in pattern, or `undefined` for user patterns. */
const PATTERN_LABELS: ReadonlyMap<string, string> = new Map(
  DEFAULT_PATTERN_TABLE.map((entry) => [entry.pattern, entry.label]),
);

const REGEX_PREFIX = "re:";

/** Escape every regex metacharacter in `text` except `*`, which becomes `.*`. */
function globBodyToRegexSource(glob: string): string {
  return glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
}

/**
 * Compile one guard pattern. Plain patterns are whole-string globs; `re:`
 * patterns are regular expressions. Both are case-insensitive. An invalid
 * regex is a config mistake the user must see, so it throws {@link AicmdError}.
 */
export function compilePattern(pattern: string): RegExp {
  if (pattern.startsWith(REGEX_PREFIX)) {
    const source = pattern.slice(REGEX_PREFIX.length);
    try {
      return new RegExp(source, "is");
    } catch (err) {
      throw new AicmdError(`Invalid dangerous-command pattern "${source}": ${(err as Error).message}`);
    }
  }
  return new RegExp(`^${globBodyToRegexSource(pattern)}$`, "is");
}

/**
 * The active guard-pattern list for a config: `dangerousPatterns` replaces
 * the defaults when set, and `extraDangerousPatterns` always appends.
 */
export function effectivePatterns(config: Pick<Config_, "dangerousPatterns" | "extraDangerousPatterns">): string[] {
  const base = config.dangerousPatterns ?? [...DEFAULT_DANGEROUS_PATTERNS];
  return [...base, ...config.extraDangerousPatterns];
}

// A local alias keeps this module importable without the full config type.
interface Config_ {
  dangerousPatterns: string[] | null;
  extraDangerousPatterns: string[];
}

/**
 * The first pattern in `patterns` that matches `command`, or `null`.
 * Returning the pattern itself lets the UI show *why* a command tripped
 * the guard.
 */
export function matchDangerousPattern(command: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    if (compilePattern(pattern).test(command)) return pattern;
  }
  return null;
}

/**
 * Combine the local guard patterns with the model's own assessment into a
 * single verdict with human-readable reasons.
 */
export function assessDanger(candidate: GeneratedCommand, patterns: string[]): DangerAssessment {
  const reasons: string[] = [];
  const matched = matchDangerousPattern(candidate.command, patterns);
  if (matched !== null) {
    const label = PATTERN_LABELS.get(matched);
    reasons.push(label !== undefined ? `matches guard pattern: ${label}` : `matches guard pattern "${matched}"`);
  }
  if (candidate.dangerous) {
    const reason = candidate.dangerReason?.trim();
    reasons.push(reason && reason.length > 0 ? reason : "The model flagged this command as dangerous.");
  }
  return {
    dangerous: reasons.length > 0,
    reasons,
    modelSignalAvailable: candidate.modelAssessed === true,
  };
}
