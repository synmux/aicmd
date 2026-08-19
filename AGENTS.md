# `aicmd` for Agents

`@synmux/aicmd` turns a natural-language task into one shell command via the
Claude Agent SDK (structured output), shows it with a danger assessment, asks
for confirmation, and runs it. Read `docs/superpowers/specs/2026-08-18-aicmd-design.md`
for the full design and decision log.

## Layout

```text
bin/aicmd.js           # runtime launcher: bun ▸ dist under node ▸ node TS stripping
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
src/ui/                # colors, ora spinner, prompts/$EDITOR, OpenTUI picker
test/                  # bun test suites (TDD; tests are written first)
```

## Rules for this repository

- **Runtime portability overrides the Bun-API house rule**: `src/` must run
  under both Bun and plain Node, so use `node:fs`, `node:child_process`,
  `node:os` etc. instead of `Bun.file`/`Bun.$`/`Bun.spawn`, keep TypeScript
  erasable-syntax-only (no enums, namespaces, parameter properties), give
  every relative import an explicit `.ts` extension, and never import JSON
  (read it with `fs`). Bun remains the dev toolchain (`bun test`, `bun run`).
- TDD: write the failing test first (`test/*.test.ts`), then implement. UI
  layout is tested with OpenTUI's headless renderer (`@opentui/core/testing`);
  thin I/O adapters (readline, $EDITOR spawn, live SDK calls) stay untested.
- Safety behavior is load-bearing: `-x` must refuse dangerous commands
  without `-f`, confirmation defaults to No, and only the command itself may
  ever be written to stdout (all chrome goes to stderr, so pipes compose).
  Two further invariants: candidates without a real model danger assessment
  (`modelAssessed` false — the plain-text fallback) must never auto-execute
  under `-x` without `-f` (`decideAction` in src/cli.ts pins this), and
  every candidate passes `normaliseCommand` (src/prompts.ts) so control
  characters or newlines can never make the confirmed text differ from the
  executed text.
- `prepack` builds `dist/aicmd.js`; publishing without it breaks every
  plain-Node install (Node refuses to type-strip inside node_modules).

## Commands

```sh
bun test               # test suite
bun run typecheck      # tsc --noEmit
bun run build          # bundle dist/aicmd.js (node target, deps external)
bun run format         # prettier
bun run bin/aicmd.ts   # run from source
```

## Bun defaults (general)

Default to Bun instead of Node.js for tooling:

- `bun <file>`, `bun test`, `bun install`, `bun run <script>`, `bunx <pkg>`
- Bun auto-loads `.env`; don't use dotenv.

The Bun-native API preferences (Bun.serve, bun:sqlite, Bun.file, Bun.$, …)
apply to Bun-only projects; **this package's `src/` is the documented
exception** (see Rules above).

<!-- skilld -->

Before modifying code, evaluate each installed skill against the current task.
For each skill, determine YES/NO relevance and invoke all YES skills before proceeding.
<!-- /skilld -->
