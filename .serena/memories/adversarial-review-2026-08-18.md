# Adversarial review outcome (2026-08-18)

A 17-agent workflow (5 lens reviewers + adversarial verifiers) reviewed the
initial aicmd implementation. 8 confirmed findings + credible cap-dropped ones
were all fixed in commit `aeac85b`. Key hardening that future changes must not
regress:

- **Danger-signal provenance**: `GeneratedCommand.modelAssessed` /
  `DangerAssessment.modelSignalAvailable`. The plain-text fallback can't carry
  the model's danger verdict, so `-x` refuses unassessed commands without
  `-f` (`decideAction` in src/cli.ts — table-tested; a fail-open mutation
  here previously survived the whole suite).
- **`normaliseCommand`** (src/prompts.ts) rejects control chars / newlines on
  BOTH paths — display-vs-execution spoofing via `\r`/ESC.
- **Guard regexes**: rm rule covers `/bin/rm`, `sudo /bin/rm`, `\rm`;
  curl|sh matches multi-stage pipes; added find -delete, rsync --delete,
  truncate -s 0, crontab -r. Patterns carry human labels
  (DEFAULT_PATTERN_TABLE).
- **Commander**: `enablePositionalOptions().passThroughOptions()` — options
  only before the first task word ("quoting optional" promise).
- **SIGINT**: executeCommand detaches ALL process SIGINT listeners while the
  child runs (cli's two-stage force-quit would otherwise orphan it);
  launcher ignores SIGINT around its spawnSync; `askLine` resolves null on
  readline EOF/Ctrl-C (previously hung).
- **Packaging**: engines node >=22.12 (commander 15 floor), prepack builds
  dist, exports map exposes index.ts under the `bun` condition only, os
  darwin/linux, tsconfig `erasableSyntaxOnly`.

Known accepted gaps: OpenTUI picker mouse-click can double-move (no public
`focusable` option; cosmetic). Final fix commit was unsigned (1Password
locked mid-session) — user should `git commit --amend -S --no-edit` if still
HEAD.
