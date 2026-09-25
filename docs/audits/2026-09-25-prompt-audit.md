# aicmd prompt audit — 2026-09-25

Audited commit: `09a482c`. Deliverables: this report, and the patch series in
`2026-09-25-prompt-audit-patches/` beside it (proposed, not applied).

## Assumptions

- **Scope**: the whole working-directory prompt surface (the request named no
  files).
- **Target model**: Claude Sonnet 5. `DEFAULT_CONFIG.model` is the `sonnet`
  alias (`src/config.ts:22`), which Claude Code 2.1.275 / Agent SDK 0.3.275
  resolves to `claude-sonnet-5` (verified live: the system `init` message
  reports `model=claude-sonnet-5`). No migration is in progress. `-m` can pick
  other models; findings say where that matters.
- **Provider markers**: none non-Anthropic. The model is reached only through
  `@anthropic-ai/claude-agent-sdk`.
- **Surface**: Agent SDK code, not raw Messages API code. SDK behaviour that
  matters here was verified live, not assumed: `outputFormat` is delivered as
  an end-turn tool call, and Claude Code runs Sonnet 5 with adaptive thinking.

## Inventory

| Surface                     | Files                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System prompt               | `src/prompts.ts` `buildSystem` + `src/context.ts` context block                                                                                                                                                |
| User prompt                 | `src/prompts.ts` `buildUser`                                                                                                                                                                                   |
| Tool schema (end-turn tool) | `src/prompts.ts` `COMMANDS_SCHEMA` (field descriptions reach the model)                                                                                                                                        |
| Request construction        | `src/agent.ts` (`buildQueryOptions`, `buildSubprocessEnv`), `src/generate.ts` (attempt ladder), `src/config.ts` / `src/types.ts` (model, `interactiveTemperature`)                                             |
| Agent context files         | `AGENTS.md` (`CLAUDE.md` symlinks to it), `docs/superpowers/specs/2026-08-18-aicmd-design.md` (AGENTS.md sends agents there), `.serena/memories/*.md`                                                          |
| Excluded                    | `.agents/skills/*-skilld` (gitignored, generated, absent); `~/.claude/CLAUDE.md` (outside the working directory); README (human docs, edited only where patches remove what it describes); user `customPrompt` |

## Provenance

- All runtime prompt text landed in one commit (`9c2ad6a`, 2026-08-19) and was
  reformatted in `89b06fe`. The prose is five weeks old and reads like it.
  What is dated is the attempt ladder, which the design spec says follows
  "the same pattern as claude-commit", importing that project's assumptions
  about models that reject temperature or structured output.
- The skill-evaluation block in `AGENTS.md` (`f28d7e1`) sits between
  `<!-- skilld -->` markers: the skilld tool manages it.
- The adversarial-review memory predates the Bun → Node and OpenTUI → Clack
  migrations (both 2026-09-13).

## Summary

| Group                      | In the diff                         | Flag only                  |
| -------------------------- | ----------------------------------- | -------------------------- |
| 1 — dated prompt text      | F1 (High), F2 (Medium), F3 (Medium) | F7 (Low)                   |
| 2 — rule and context files | F4 (Medium), F5 (Medium)            | F6 (Low)                   |
| 3 — tool descriptions      | covered by F3; otherwise clean      | —                          |
| 4 — request config         | F1 is also a Group 4 API fossil     | F8, F9, F10 (out of scope) |

The three highest-impact findings:

1. **F1 — the temperature rung is dead code with a latency tax.** Claude Code
   runs Sonnet 5 with thinking on, and the API then accepts only
   `temperature: 1`. aicmd's default _is_ 1, so the rung sends the API
   default (a no-op); any other configured value is a guaranteed 400 and a
   wasted ~1.5 s subprocess before the ladder silently drops it. The variety
   the setting promised already comes from the prompt, and three distinct
   candidates (`tar`, `zip`, `ditto`) came back with no temperature at all.
2. **F2 — the plain-text fallback is the JSON-forcing stack, kept alive for a
   model that no longer exists.** Structured output reaches the model as an
   end-turn tool, which every tool-capable Claude model supports. The rung
   only ever catches failures of the structured call, and answers them with
   an unassessed command that needs a whole parallel safety path. When the
   model's reply spans several lines, `cleanCommand` truncates it to the
   first, which is exactly what `normaliseCommand` refuses to do.
3. **F5 — `AGENTS.md` tells agents to run a formatter that breaks the lint
   gate.** `pnpm run format` rewrites 39 files, after which biome reports 37
   errors.

## Findings (by confidence)

### F1 — High — sampling-temperature rung

| Field        | Content                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location     | `src/generate.ts:77-82`, `src/agent.ts:30-36,76-77,90-111,187`, `src/config.ts:26,136-140`, `src/types.ts:23-28`                                                                                                                                                                                                                                                                                   |
| Evidence     | `interactiveTemperature: 1`; `if (temperature != null) attempts.push({ structured: true, temperature })`; `env.CLAUDE_CODE_EXTRA_BODY = JSON.stringify({ ...extra, temperature })`; clamp `Math.min(2, …)`                                                                                                                                                                                         |
| Pattern      | 1b — non-default `temperature` and dead 400-retry paths; Group 4 API fossil                                                                                                                                                                                                                                                                                                                        |
| Why obsolete | Sonnet 5 rejects non-default sampling parameters, and Claude Code's thinking mode accepts only 1. Verified live: `400 temperature may only be set to 1 when thinking is enabled or in adaptive mode`. The default (1) equals the API default, and the 0..2 clamp also exceeds the API's 0..1 range. Within-response variety comes from `buildUser`'s "genuinely different approaches" instruction. |
| Confidence   | High (errors on the target model, verified)                                                                                                                                                                                                                                                                                                                                                        |
| Action       | `replace-with-API-feature` / remove: patch 0001 (the prompt instruction that replaces it already exists)                                                                                                                                                                                                                                                                                           |

### F2 — Medium — plain-text fallback rung

| Field        | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location     | `src/prompts.ts:14,157-160,187-192,196-245`, `src/generate.ts:82,112`, `src/types.ts:78-84,92-97`, `src/safety.ts:171`, `src/cli.ts:157,180,349-357,401-412`, `src/ui/interactive.ts:106-113`, `index.ts`                                                                                                                                                                                                                                                                                                                                            |
| Evidence     | `'Output ONLY the command itself on a single line: no markdown, no code fences, no quotes, no preamble, no explanation.'`; `===OPTION===` delimiter protocol; `Do not number the options or add any other text.`; `cleanCommand` fence/quote regex; `modelAssessed` / `refuse-unassessed`                                                                                                                                                                                                                                                            |
| Pattern      | 1b — the JSON-forcing stack structured outputs replace ("output ONLY…", regex extraction, retry ladder); 1a — `ONLY`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Why obsolete | Its stated trigger ("models that reject structured output") cannot occur: the Agent SDK delivers `outputFormat` through an end-turn tool call. So the rung only catches failures of the structured call and turns them into degraded, unassessed commands. `cleanCommand` keeps the first line of a multi-line reply (pinned by a test), contradicting `normaliseCommand`'s reject-don't-truncate rule. The README already promises "never mangled markdown to regex apart", and the design log says "structured output replaces defensive parsing". |
| Confidence   | Medium. The stated purpose is dead (verified). Removing it changes failure semantics: an error instead of a degraded command. That is a product call.                                                                                                                                                                                                                                                                                                                                                                                                |
| Action       | `remove`: patch 0003, with the whole cascade. The model-facing prompts are byte-for-byte unchanged, checked mechanically. If you decline, at least rewrite line 158 as `'Reply with just the command on one line - it is run verbatim, so leave out markdown, code fences, quotes and commentary.'`                                                                                                                                                                                                                                                  |

### F3 — Medium — the danger definition is stated twice, and the copies disagree

| Field        | Content                                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location     | `src/prompts.ts:37-48` (schema) vs `src/prompts.ts:146-151` (system prompt)                                                                                                                                           |
| Evidence     | Schema: "changes system state, elevates privileges, writes to devices". System prompt: "changes system state or configuration, elevates privileges, writes to raw devices".                                           |
| Pattern      | 1c — duplicated rules the model must reconcile (keep-list #8 carve-out: the duplicates disagree)                                                                                                                      |
| Why obsolete | Sonnet 5 follows instructions literally (documented), and "writes to devices" literally covers every `2>/dev/null`.                                                                                                   |
| Confidence   | Medium. Measured honestly: Sonnet 5 already reconciles the two. Before and after, benign `/dev/null` redirections were flagged 0/9 and raw-disk `dd` controls 3/3. This is hygiene with no measured behaviour change. |
| Action       | `rewrite`: patch 0002. The reconciled definition lives only in the schema (the field's contract); the system prompt keeps the instruction to assess.                                                                  |

### F4 — Medium — stale agent memory

| Field        | Content                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location     | `.serena/memories/adversarial-review-2026-08-18.md:5,23,25-26,29,31`                                                                                                                                                                                                                                                                                                                                 |
| Evidence     | "fixed in commit `aeac85b`" (no such object); "launcher ignores SIGINT around its spawnSync" (no spawnSync); "`askLine` resolves null" (gone); "engines node >=22.12" (now `^24.21.0`); "exports map exposes index.ts under the `bun` condition" (exports is only `./package.json`); OpenTUI gap (OpenTUI removed); "user should `git commit --amend -S --no-edit` if still HEAD" (stale imperative) |
| Pattern      | Group 2 — volatile specifics; history narratives                                                                                                                                                                                                                                                                                                                                                     |
| Why obsolete | Agents load this memory as context, and seven of its claims are false against the current code.                                                                                                                                                                                                                                                                                                      |
| Confidence   | Medium (each claim checked against the repo)                                                                                                                                                                                                                                                                                                                                                         |
| Action       | `rewrite`: patch 0004. Present-tense, still-true hardening list, with pointers to `AGENTS.md` for the routing invariants (so it holds with or without 0003).                                                                                                                                                                                                                                         |

### F5 — Medium — `AGENTS.md`'s formatter instruction breaks the lint gate

| Field        | Content                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location     | `AGENTS.md:70`, `package.json:60`                                                                                                                                                                                         |
| Evidence     | `pnpm run format        # prettier` → `"format": "prettier --write ."`                                                                                                                                                    |
| Pattern      | Group 2 — verify surviving factual claims against current code                                                                                                                                                            |
| Why obsolete | Trunk keeps prettier off `**/*.ts`, `**/*.js` and `**/*.json` (biome owns them), but the script ignores that scoping. Verified: at `09a482c` it rewrites 39 files (+4727/−4241), then `biome check` fails with 37 errors. |
| Confidence   | Medium (verified)                                                                                                                                                                                                         |
| Action       | `add`: patch 0005, a `.prettierignore` mirroring trunk. The instruction becomes true as written: a no-op on a clean tree, biome green.                                                                                    |

## Reviewed and kept

- Role line, "You are an expert command-line engineer…": one sentence, and task context follows it (keep-list #9).
- "Do not perform the task yourself and do not ask questions": a real product constraint (single turn, no tools, no channel for clarification). It could carry its reason, but it isn't cruft.
- "Each "command" field must contain the raw command text only - no markdown, no code fences, no surrounding quotes": load-bearing. The field runs verbatim under `sh -c`, and a backtick-wrapped command becomes command substitution.
- "mind BSD vs. GNU flag differences, which are a notorious pitfall": reasoned emphasis about an observed failure, and the only such guidance when `includeContext` is off.
- The context block and fish hints: environment facts (keep-list #1).
- "Produce exactly N distinct command options - genuinely different approaches or tools": the correct replacement for temperature-driven variety (the Sonnet 5 guide's recommended substitute).
- The `explanation` rule duplicated in schema and prompt: the copies agree (keep-list #8).
- `AGENTS.md` prohibitions (for example "Do not use Clack's `spinner()`: it calls `process.exit(0)`…"): each carries its reason.
- Signal scan: no thinking scaffolds, step scripts, grader vocabulary, retired model names, reminder cadences, anti-formatting rules, hedges or trait claims anywhere in the inventory.
- Group 4: one model call site (`generateCommands` → `runPrompt`), and the work is genuinely adaptive. Single turn, so nothing edits history. The prompt is below the cacheable minimum and has nothing volatile in it. No budget countdowns, no sub-agents.

## Flags (not in the diff)

- **F6 (Low)**: `AGENTS.md:75-79`, the skilld-managed "evaluate each installed skill… YES/NO… invoke all YES skills" ritual. It is scripted choreography for a judgement call, and a literal model enumerates every installed skill (well over 100 in this environment) before each code change. It is routing text, though, and skills do under-trigger; skilld also rewrites the block, so hand edits won't stick. If you want it gone, configure skilld. It also duplicates your global `CLAUDE.md` word for word.
- **F7 (Low)**: "elevates privileges" in the danger definition. Sonnet 5 flags real escalation (root shells, sudoers grants: 4/4) but not incidental read-only `sudo` (`sudo lsof`, `sudo du`, `sudo find`: 0/8), and no guard pattern covers `sudo`. So `aicmd -x "show which process is listening on port 80"` auto-runs `sudo lsof …`. The omission of `sudo` from the guard list (fish parity) suggests that is intended. If it isn't, enforce it in code (a `sudo`/`doas` guard pattern) rather than with more prose.
- **F8 (out of scope)**: no `effort` or `thinking` is set, so each call inherits Claude Code's defaults (adaptive thinking on, confirmed by the 400 above). For one-line commands a lower `effort` is worth measuring; `/claude-api cost-optimize` is the right tool.
- **F9 (out of scope)**: `src/agent.ts:207-209` reports the first `modelUsage` key as "the model". Claude Code also makes an auxiliary `claude-haiku-4-5` call (~924 in / 12 out tokens, ~23% of a tiny request's cost), so `-v` prints `cost $0.0049 (claude-haiku-4-5-20251001)` for a Sonnet 5 run (seen live). Take the model from the system `init` message instead.
- **F10 (out of scope)**: stale code comments, `src/config.ts:10-12` (`Bun.file` / "Bun-API preference") and `src/types.ts:31` ("bundled with ora").

## Proposed diff

| Patch                                                             | Finding | Applies alone on `09a482c`? |
| ----------------------------------------------------------------- | ------- | --------------------------- |
| `0001-fix-generate-drop-the-sampling-temperature-rung.patch`      | F1      | yes                         |
| `0002-refactor-prompts-state-the-danger-definition-once-in.patch` | F3      | yes                         |
| `0003-refactor-generate-remove-the-plain-text-fallback-run.patch` | F2      | needs 0001 and 0002         |
| `0004-docs-serena-rewrite-the-adversarial-review-memory-in.patch` | F4      | yes                         |
| `0005-chore-format-keep-prettier-off-the-files-biome-owns.patch`  | F5      | yes                         |

Each patch removes every reference to what it deletes (tests, docs, the design
spec's decisions log, `AGENTS.md`, `index.ts` re-exports). Verified at the tip
of the series: `tsc` clean; vitest 208/208 (229 at HEAD, with tests for
removed code dropped and replacements added); biome clean; prettier drift
39 → 0.

## Verification (Step 7)

40 live calls through the repo's own isolated `runPrompt`, roughly $0.30
API-equivalent, billed to the subscription:

- Alias resolution: `sonnet` → `claude-sonnet-5`.
- Temperature: 1 accepted, 0.5 → 400 (F1).
- Danger definition before/after: 12 runs each, no change (F3).
- Read-only `sudo`: 0/8 flagged; escalation: 4/4 flagged (F7).
- Patched CLI end to end: dry-run stdout is only the command, and three
  distinct candidates came back with no temperature.
- Mechanical check that 0003 leaves the system prompt, user prompt and schema
  byte-for-byte identical.
