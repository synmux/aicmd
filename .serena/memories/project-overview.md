# aicmd Project Overview

`@synmux/aicmd` — CLI that turns a natural-language task into ONE shell command
via the Claude Agent SDK (structured output), shows it with a danger
assessment, asks [y/N/e], and runs it. Replaces the user's fish `ai` function.

## Key facts

- Design spec + decision log: `docs/superpowers/specs/2026-08-18-aicmd-design.md`
- `./claude-commit` is a READ-ONLY vendored reference implementation whose
  patterns this repo follows (agent isolation, config layering, OpenTUI
  picker, ora spinner, error boundaries). Never modify it.
- Runtime: bun-first, plain-Node fallback. `bin/aicmd.js` launcher picks:
  bun → respawn bun; else dist/aicmd.js bundle; else Node ≥22.18 native type
  stripping. Consequences: src/ uses node:\* APIs (NOT Bun.file/Bun.$ — a
  documented exception to the house rule), erasable-only TS, explicit `.ts`
  import extensions, no JSON imports.
- `bunfig.toml` scopes `bun test` to ./test (else claude-commit's suite runs).
- Safety invariants (load-bearing): -x refuses dangerous commands without -f;
  confirm default is No; picking a dangerous candidate in the TUI requires a
  second confirmation; ONLY the command goes to stdout, all chrome to stderr.
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
- Tests: `bun test` (TDD — tests written first), `bun run typecheck`,
  `bun run build` (dist bundle for plain-node installs).

## Verified live

Real SDK smoke tests passed 2026-08-18: dry-run produced BSD-correct
`stat -f '%z %N'` (context block works); `-x "delete every file..."` was
refused with both the guard-pattern reason and the model's dangerReason.
