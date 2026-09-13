# aicmd — Design Specification

Date: 2026-08-18
Status: Approved for implementation (autonomous session; decisions recorded here)

## Purpose

`aicmd` is a CLI that turns a natural-language task description into a single
shell command using the Claude Agent SDK, shows the command (with an
explanation and a danger assessment), and asks for permission before running
it. It replaces a fish-shell function that shelled out to `claude -p` and
parsed free-form text; the Agent SDK's structured output mode removes the
output-mangling problem entirely, and subscription auth removes the API bill.

Published as `@synmux/aicmd` with binaries `aicmd` and `ai`.

## Non-Goals

- Multi-line scripts or multi-step plans. One command per run (pipes, `&&`,
  `;` within one line are fine).
- Performing the task itself. The model writes a command; it never executes
  anything during generation (no tools are exposed to it).
- Persisting shell state into the parent shell (`cd`, exports). The command
  runs in a child shell; this is documented.

## Architecture

Same shape as [claude-commit](https://github.com/synmux/claude-commit), the
external pattern source:

```text
bin/aicmd.js           # runtime launcher (plain JS): dist under node ▸ node TS stripping
bin/aicmd.ts           # TypeScript entry, thin: calls run(argv)
index.ts               # library barrel (source-only; the package is a CLI first)
src/cli.ts             # Commander program + orchestration + mode resolution
src/generate.ts        # generation pipeline (structured-first, fallbacks)
src/agent.ts           # Claude Agent SDK wrapper (isolated single-turn call)
src/prompts.ts         # system/user prompt builders, JSON schema, cleanup
src/safety.ts          # dangerous-command detection (globs + regex + model flag)
src/exec.ts            # run the approved command in the target shell
src/config.ts          # config discovery, sanitization, precedence
src/context.ts         # platform/shell context block for the prompt
src/errors.ts          # AicmdError (expected, user-facing failures)
src/types.ts           # shared interfaces
src/utils.ts           # version lookup
src/ui/colors.ts       # minimal ANSI helper for the few non-Clack stderr lines
src/ui/chrome.ts       # Clack chrome on stderr (command block, warnings, notes, cancel/outro)
src/ui/spinner.ts      # hand-rolled spinner: cli-spinners frames, Clack glyphs (stderr only)
src/ui/prompt.ts       # Clack text prompt for the task; y/N/e confirm (SelectKeyPrompt); $EDITOR
src/ui/interactive.ts  # Clack SelectPrompt picker for -i multi-candidate mode
test/*.test.ts         # vitest suites for all deterministic logic
test/terminal.ts       # fake terminal driving real prompts through PassThrough/Writable
```

## Runtime Strategy (plain Node, TypeScript sources)

Revised 2026-09-13: Bun was removed from the repository. Node 24 (pinned by
mise) is the only runtime, pnpm the package manager, vitest the test runner
and esbuild the bundler.

- `bin/aicmd.js` is plain JavaScript with `#!/usr/bin/env node`, resolving in
  two steps:
  1. `dist/aicmd.js` present (every published install; `prepack` builds it
     with `esbuild --bundle --platform=node --format=esm --packages=external`):
     import the bundled build. This step is what makes installs work at
     all — Node refuses to type-strip files inside `node_modules` — and sets
     the supported floor at Node ≥ 22.12 (commander 15's requirement).
  2. Development checkout without a build: import the TypeScript entry under
     Node's native type stripping (Node ≥ 22.18), with an actionable error
     message when that fails.
- All TypeScript is erasable-syntax-only (enforced by `erasableSyntaxOnly` in
  tsconfig), relative imports carry explicit `.ts` extensions, JSON is read
  with `fs` rather than imported, and only `node:*` APIs are used. Sources
  are never compiled for development or tests; the bundle is a packaging
  artefact only.
- The package `exports` map exposes only `./package.json`; `index.ts` is a
  source-only barrel and the published package is a CLI first.
- pnpm's `minimumReleaseAge` (one week) means `pnpm add` resolves to the
  newest version at least a week old; `allowBuilds` in pnpm-workspace.yaml
  replaces Bun's `trustedDependencies` (esbuild is approved there).

## Generation Pipeline

Single model stage (unlike claude-commit's two): the task prompt is small.

1. Build a system prompt from config: target shell, platform context
   (`os.platform()/release()/arch()`, BSD-vs-GNU warning on macOS), single-line
   requirement, danger-assessment instructions, and `customPrompt` extras.
2. Ask for structured output against `COMMANDS_SCHEMA`:

   ```json
   {
     "commands": [
       {
         "command": "single-line shell command",
         "explanation": "one concise sentence",
         "dangerous": true,
         "dangerReason": "why (required when dangerous)"
       }
     ]
   }
   ```

3. Attempt ladder (same pattern as claude-commit): structured + temperature
   (only when count > 1 and `interactiveTemperature` set) → structured →
   plain text with cleanup (`cleanCommand`: strip fences/quotes, first
   non-empty line). Whichever succeeds first wins.
4. Dedupe by command text; empty result → `AicmdError`.

The SDK call is fully isolated exactly like claude-commit (`tools: []`,
`skills: []`, `mcpServers: {} + strictMcpConfig`, `plugins: []`,
`settingSources: []`, `maxTurns: 1`) and strips `ANTHROPIC_API_KEY` /
`ANTHROPIC_AUTH_TOKEN` unless `allowApiKey` is enabled.

## Safety Model

Two independent signals, OR-ed together:

1. **Local patterns** — the _built-in defaults_ are labelled `re:` regexes
   with token boundaries (see `DEFAULT_PATTERN_TABLE` in `src/safety.ts`, the
   authoritative list): a bare `*rm *` glob would false-positive on
   `echo confirm this`, while the shipped regex still catches `/bin/rm`,
   `sudo rm` and the `\rm` alias bypass. _User-supplied_ patterns remain
   fish-style whole-string globs (`*` wildcard) for parity with the original
   fish guard list, with the `re:` prefix as the regex escape hatch. Config:
   `dangerousPatterns` (replaces defaults when set) and
   `extraDangerousPatterns` (appends).
2. **Model self-assessment** — the `dangerous` boolean + `dangerReason` from
   structured output. Free coverage for everything a pattern list misses.

Signal provenance is tracked: candidates carry `modelAssessed`, and the
plain-text fallback (which cannot carry the model's verdict) marks them
unassessed. A degraded verdict is never silent — every mode prints a note,
and `-x` refuses to auto-execute on the pattern list alone unless `-f`.

Command hygiene: candidates containing control characters or literal
newlines are rejected (`normaliseCommand`) rather than displayed, so the
confirmed text is always exactly the executed text.

Behavioural matrix (mirrors the fish script):

| Mode            | Safe command         | Dangerous command                           |
| --------------- | -------------------- | ------------------------------------------- |
| default (TTY)   | show + confirm y/N/e | show + red warning + confirm y/N/e          |
| `-x/--execute`  | run immediately      | refuse, print command, exit 1, suggest `-f` |
| `-x -f/--force` | run immediately      | warn loudly, run anyway                     |
| `-d/--dry-run`  | print to stdout      | print to stdout (warning on stderr)         |
| no TTY, no `-x` | behaves as dry-run   | behaves as dry-run (warning on stderr)      |

`--dry-run` and the no-TTY fallback write **only the command** to stdout so
`aicmd -d "..." | pbcopy` and `aicmd "..." | sh` compose; all chrome goes to
stderr.

## CLI Surface

```text
aicmd [options] [task...]
  -x, --execute            run without confirmation (dangerous still refused)
  -f, --force              with -x: run even when flagged dangerous
  -d, --dry-run            print the command to stdout and exit
  -i, --interactive        pick between several candidates in a TUI
      --no-interactive     override "interactive": true from config
  -n, --count <n>          candidates to generate in interactive mode
  -m, --model <model>      model to use (default sonnet)
  -s, --shell <shell>      target shell for generation + execution
  -p, --prompt <text>      extra instructions appended to the system prompt
      --no-context         omit platform/shell context from the prompt
      --no-spinner         disable the progress spinner
      --config <path>      explicit config file
  -v, --verbose            cost, served model, and debug output on stderr
  -V, --version / -h, --help
```

Task input: argv words joined; empty argv + TTY → Clack text prompt on
stderr; empty argv + piped stdin → read the task from stdin.

Confirm prompt: a Clack `SelectKeyPrompt` (`Run this command?` with
`y Yes · n No · e Edit`) answered by one keypress. `e` opens `$EDITOR`
(GIT_EDITOR ▸ VISUAL ▸ EDITOR ▸ vi) on the command before running the edited
text (re-checked against the danger patterns). Default is **No** (running a
shell command is riskier than committing): Enter, Escape, Ctrl-C and EOF all
resolve to No.

Interactive mode: a Clack `SelectPrompt` with a custom frame
(`renderPickerFrame`, pure) listing every candidate as two rows — the
command (prefixed `⚠` when dangerous) and its explanation or danger reason —
so options can be compared without moving the cursor. ↑/↓/j/k navigate,
⏎ run, `e` edit-then-run, `q`/Esc/Ctrl-C cancel. Overflow scrolls through
Clack's `limitOptions`, keeping the cursor in view. Explicit `-i` without a
TTY is a hard error; config-driven interactive without a TTY quietly falls
back to printing. (The OpenTUI picker and its readline fallback were replaced
on 2026-09-13; see the decisions log.)

Chrome (`src/ui/chrome.ts`): Clack's guide-bar look — `intro` on a TTY, the
command in a titled `note` box, `log.warn` for danger warnings, dim
`log.message` lines for explanations and notes, `log.error` for refusals,
`cancel` / `outro` to close. The guide bar is drawn only when stderr is a
terminal; piped stderr gets the same text as plain lines. Every helper takes
its output stream and defaults to stderr.

Spinner (`src/ui/spinner.ts`): hand-rolled on cli-spinners frames and Clack
glyphs. While spinning on a TTY it discards typed input (so keystrokes cannot
pre-answer the confirmation) and re-raises Ctrl-C as SIGINT so the two-stage
cancel in `src/cli.ts` keeps working.

## Execution

`spawn(shell, ["-c", command], { stdio: "inherit" })` where shell resolves
config.shell ▸ `$SHELL` ▸ `/bin/sh`. The child's exit code becomes aicmd's
exit code; a signal-terminated child maps to `128 + signal`. SIGINT while the
child runs is forwarded naturally via the shared terminal (aicmd ignores it
until the child exits so the child owns Ctrl-C).

## Configuration

Precedence (low → high), same machinery as claude-commit:

1. Built-in `DEFAULT_CONFIG`.
2. Global: `$XDG_CONFIG_HOME/aicmd/config.json` (default
   `~/.config/aicmd/config.json`); dotted names also accepted there.
3. `package.json` `aicmd` key (nearest one found walking up from cwd).
4. Nearest `.aicmd.json` / `.aicmdrc.json` / `.aicmdrc`, walking cwd → filesystem
   root (aicmd is not git-bound, so the walk does not stop at a repo root).
5. CLI flags.

```json
{
  "model": "sonnet",
  "shell": null,
  "interactive": false,
  "interactiveCount": 3,
  "interactiveTemperature": 1,
  "spinner": "material",
  "customPrompt": null,
  "includeContext": true,
  "showExplanation": true,
  "dangerousPatterns": null,
  "extraDangerousPatterns": [],
  "allowApiKey": false
}
```

`sanitizePartial` stays conservative: unknown keys and wrong types are
ignored, counts floored/min-clamped, temperature clamped 0..2, unknown
spinner names dropped, pattern arrays filtered to strings.

## Error Boundaries

`AicmdError` = expected failure → `error: ...` on stderr, exit 1, no stack.
Everything else bubbles to the bin and prints a stack. Known SDK assistant
error codes map to actionable messages (auth, billing, rate limit,
overloaded, model-not-found, max-output) exactly as in claude-commit.

## Testing

`pnpm test` (vitest):

- `safety.test.ts` — glob→regex conversion, default pattern hits/misses,
  `re:` patterns, replace-vs-extend config semantics, model-flag OR.
- `config.test.ts` — sanitization, precedence including XDG global dir,
  package.json key, walk-up discovery, explicit path errors.
- `prompts.test.ts` — system prompt variants, schema extraction,
  `cleanCommand` fence/quote/multi-line stripping.
- `generate.test.ts` — injectable runner: structured success, fallback
  ladder, temperature retry, dedupe, empty → error.
- `cli.test.ts` — `resolveRunMode` matrix (execute/dry-run/TTY),
  `decideAction` safety-routing matrix (dangerous × force × signal
  provenance), `buildProgram` argv parsing (positional options, `--`,
  count validation), `flagsToConfig` mapping.
- `context.test.ts` — context block for given platform/shell/env.
- `exec.test.ts` — real `/bin/sh` runs: exit-code and signal mapping, and
  the SIGINT-takeover/restore contract while a child runs.
- `prompt-ui.test.ts` — editor resolution order, `parseConfirmAnswer`
  (default No), `renderConfirmFrame`, and `confirmRun` driven through fake
  streams (Enter/Escape/Ctrl-C → No, y/n/e, unrelated keys ignored).
- `bin.test.ts` — the TypeScript entry and the launcher report the version
  under Node; `--help` documents the safety flags.
- `interactive.test.ts` — `pickerEntryLabel`, `renderPickerFrame` (every
  command and explanation, danger marker, scroll indicator on a small
  terminal), and `selectCommand` driven through fake streams (arrows, j/k
  with wrap, Enter, `e`, `q`/Escape/Ctrl-C).
- `spinner.test.ts` — name resolution; the `Spinner` under fake timers
  (silent when disabled, frames and label when enabled, update, stop,
  restart, timer cleanup).
- `chrome.test.ts` — every chrome helper writes its text to the given
  stream and nothing to `process.stdout`/`process.stderr`.
- `test/terminal.ts` — the fake terminal: PassThrough input, collecting
  Writable output with `columns`/`rows`, `press()` with the timing readline
  needs to settle a lone Escape.

No tests for the live SDK path or `$EDITOR` (isolated behind adapters,
mirroring claude-commit's boundary choices). Manual end-to-end runs through
`expect` with a sized pty verified the confirm prompt, the picker and Ctrl-C
during generation on 2026-09-13.

## Decisions Log

- **Single generation stage** — a task prompt is tiny; claude-commit's
  chunk/summarize machinery has no equivalent input here. YAGNI.
- **Globs, not regexes, for user patterns** — direct fish-config parity for
  the user's existing `dangerous_patterns`; `re:` covers power users.
- **Default answer No** on the confirm prompt (fish parity; destructive
  surface is larger than a git commit).
- **No tools for the model** — the fish script told the model to check
  `man`/`--help`, but that ran with Claude Code's tool sandbox; here an
  isolated single-turn completion with explicit platform context is safer,
  faster, cheaper, and deterministic. Structured output replaces defensive
  parsing.
- **node:fs/node:child_process over Bun APIs** — originally required by the
  node fallback; since 2026-09-13 Node is the only runtime, so `node:*` is
  simply the rule.
- **Bun removed (2026-09-13)** — the repository moved to plain Node 24 with
  pnpm, vitest and esbuild. The launcher no longer probes for Bun; sources
  stay TypeScript and run under Node's native type stripping.
- **OpenTUI → Clack (2026-09-13)** — `@opentui/core` requires Bun or
  Node ≥ 26.4 with `--experimental-ffi`, and it backed exactly one screen.
  `@clack/core` prompts with custom render functions replace the picker and
  the readline confirm; `@clack/prompts` provides the chrome. The readline
  picker fallback was dropped (Clack has no native engine that can fail to
  initialise, and `-i` already requires a TTY).
- **Hand-rolled spinner, not Clack's** — Clack's `spinner()` enters raw mode
  and calls `process.exit(0)` on Ctrl-C, which would bypass the two-stage
  SIGINT handling and report success on a cancelled run. Ours only draws
  frames, discards typed input while spinning, and re-raises Ctrl-C as
  SIGINT. ora was dropped with it; cli-spinners stays for the named frames.
- **Guide bar only on a TTY** — Clack chrome passes `withGuide: isTTY(output)`
  so piped stderr stays plain text.
- **`ai` as a second bin name** — matches the fish function it replaces;
  users who fear collisions simply don't use it.
