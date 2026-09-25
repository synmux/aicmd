# aicmd Project Overview

`@synmux/aicmd` — CLI that turns a natural-language task into ONE shell command
via the Claude Agent SDK (structured output), shows it with a danger
assessment, asks y/N/e, and runs it. Replaces the user's fish `ai` function.

## Key facts

- Design spec + decision log: `docs/superpowers/specs/2026-08-18-aicmd-design.md`
- Architecture patterns (agent isolation, config layering, error boundaries)
  follow the external claude-commit project (github.com/synmux/claude-commit).
- Runtime (since 2026-09-13): plain Node 24 (mise), pnpm, vitest, esbuild.
  NO Bun anywhere. `bin/aicmd.js` launcher: dist/aicmd.js if present, else
  the TypeScript entry under Node type stripping. Consequences: src/ uses
  node:\* APIs only, erasable-only TS, explicit `.ts` import extensions, no
  JSON imports. The esbuild bundle exists only because Node will not
  type-strip inside node_modules.
- Terminal layer (since 2026-09-13): Clack. `src/ui/chrome.ts` (note/log/
  cancel/outro on stderr, guide bar only on a TTY), `src/ui/prompt.ts`
  (Clack text prompt for the task; y/N/e confirm as a SelectKeyPrompt),
  `src/ui/interactive.ts` (SelectPrompt picker with pure renderPickerFrame,
  keys e/q added via prompt.on('key')), `src/ui/spinner.ts` (hand-rolled:
  cli-spinners frames + Clack glyphs; NOT Clack's spinner, which
  process.exit(0)s on Ctrl-C and would break the two-stage SIGINT design).
- Safety invariants (load-bearing): -x refuses dangerous commands without -f;
  confirm default is No (Enter/Esc/Ctrl-C/EOF all No); picking a dangerous
  candidate in the picker requires a second confirmation; ONLY the command
  goes to stdout, all chrome to stderr (every chrome helper takes an output
  stream param).
- Danger = local guard patterns (fish-style globs + `re:` regexes,
  case-insensitive; defaults in src/safety.ts) OR model's `dangerous` flag
  from structured output. `dangerousPatterns` config replaces defaults,
  `extraDangerousPatterns` appends.
- Config precedence: defaults < ~/.config/aicmd/config.json (XDG) < nearest
  package.json `aicmd` key (walk-up) < nearest .aicmd.json/.aicmdrc(.json)
  (walk-up) < flags.
- Agent SDK isolation (src/agent.ts): tools/skills/plugins [], mcpServers {}
  - strictMcpConfig, settingSources [], maxTurns 1; ANTHROPIC_API_KEY/
    AUTH_TOKEN stripped unless allowApiKey.
- Tests: `pnpm test` (vitest; TDD — tests written first), `pnpm run
typecheck`, `pnpm run build`. Prompts are tested for real via
  `test/terminal.ts` (PassThrough input + collecting Writable with
  columns/rows; `press()` waits 80ms after a lone Escape for readline's
  escape timeout). Spinner tests use vi.useFakeTimers.
- pnpm `minimumReleaseAge` = 1 week, so `pnpm add` picks versions ≥ 7 days
  old; build scripts must be approved in pnpm-workspace.yaml `allowBuilds`.

## Verified live

- 2026-08-18: real SDK smoke tests (BSD-correct stat; -x refusal with reasons).
- 2026-09-13: on Node 24 — dry run piped to a file put only the command on
  stdout; `expect` sessions (pty sized with `stty rows 24 columns 100`, else
  Clack hard-wraps every char) verified confirm → n → exit 1, picker j/q →
  exit 1, and Ctrl-C mid-generation → "Generation was cancelled." exit 1.
