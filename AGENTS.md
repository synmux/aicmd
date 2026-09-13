# `aicmd` for Agents

`@synmux/aicmd` turns a natural-language task into one shell command via the
Claude Agent SDK (structured output), shows it with a danger assessment, asks
for confirmation, and runs it. Read `docs/superpowers/specs/2026-08-18-aicmd-design.md`
for the full design and decision log.

## Layout

```text
bin/aicmd.js           # runtime launcher (plain JS): dist under node ▸ node TS stripping
bin/aicmd.ts           # thin entry calling run()
index.ts               # library re-exports
src/cli.ts             # Commander program, run-mode resolution, flows
src/generate.ts        # structured-first attempt ladder
src/agent.ts           # isolated single-turn Agent SDK wrapper
src/prompts.ts         # schema + prompt builders + plain-text cleanup
src/safety.ts          # guard patterns (globs + re:) + model-flag combination
src/exec.ts            # shell -c execution, exit-code/signal mapping
src/config.ts          # XDG global / package.json / rc-file discovery
src/context.ts         # platform + shell context block
src/ui/chrome.ts       # Clack chrome on stderr: command block, warnings, notes, cancel/outro
src/ui/spinner.ts      # hand-rolled spinner (cli-spinners frames, Clack glyphs)
src/ui/prompt.ts       # Clack text prompt for the task, y/N/e confirm, $EDITOR
src/ui/interactive.ts  # Clack SelectPrompt picker for -i multi-candidate mode
src/ui/colors.ts       # minimal ANSI helper for the few non-Clack stderr lines
test/                  # vitest suites (TDD; tests are written first)
test/terminal.ts       # fake terminal: drives real prompts through PassThrough/Writable
```

## Rules for this repository

- **Plain Node, TypeScript sources.** The runtime is Node 24 (mise), the
  package manager is pnpm, and there is no Bun anywhere. Node runs the `.ts`
  files natively (type stripping), so keep TypeScript erasable-syntax-only
  (no enums, namespaces, parameter properties), give every relative import
  an explicit `.ts` extension, never import JSON (read it with `fs`), and
  use `node:*` APIs only. The esbuild bundle (`dist/aicmd.js`) exists solely
  because Node refuses to type-strip inside `node_modules`; `prepack` builds
  it and publishing without it breaks every install.
- **The terminal layer is Clack.** Prompts come from `@clack/core`
  (`SelectPrompt`, `SelectKeyPrompt`) with our own render functions; chrome
  comes from `@clack/prompts` (`note`, `log`, `cancel`, `outro`). Every
  helper takes its output stream and defaults to **stderr**. Do not use
  Clack's `spinner()`: it calls `process.exit(0)` on Ctrl-C from raw mode,
  which would defeat the two-stage SIGINT handling in `src/cli.ts`.
- TDD: write the failing test first (`test/*.test.ts`), then implement.
  Prompts are tested for real through `test/terminal.ts` (fake input and
  output streams, key sequences from `KEY`); frame renderers are pure
  functions asserted on directly; the spinner runs under fake timers. Thin
  I/O adapters (`$EDITOR` spawn, live SDK calls) stay untested.
- Safety behavior is load-bearing: `-x` must refuse dangerous commands
  without `-f`, confirmation defaults to No (Enter, Escape, Ctrl-C and EOF
  all mean No), and only the command itself may ever be written to stdout
  (all chrome goes to stderr, so pipes compose). Two further invariants:
  candidates without a real model danger assessment (`modelAssessed`
  false — the plain-text fallback) must never auto-execute under `-x`
  without `-f` (`decideAction` in src/cli.ts pins this), and every candidate
  passes `normaliseCommand` (src/prompts.ts) so control characters or
  newlines can never make the confirmed text differ from the executed text.

## Commands

```sh
pnpm test              # vitest run
pnpm run test:watch    # vitest
pnpm run typecheck     # tsc --noEmit
pnpm run build         # esbuild → dist/aicmd.js (node platform, ESM, deps external)
pnpm start             # build, then run bin/aicmd.js as an install would
pnpm run format        # prettier
pnpm exec biome check  # lint (the pre-commit hook runs it via trunk)
node bin/aicmd.ts      # run from source
```

<!-- skilld -->

Before modifying code, evaluate each installed skill against the current task.
For each skill, determine YES/NO relevance and invoke all YES skills before proceeding.
<!-- /skilld -->
