---
name: skilld-skilld
description: "Generate AI agent skills from npm package documentation. ALWAYS use when writing code importing \"skilld\". Consult for debugging, best practices, or modifying skilld."
metadata:
  version: 2.3.0
  generated_by: cached
  generated_at: 2026-08-18
---

# skilld-dev/skilld `skilld@2.3.0`
**Tags:** latest: 2.3.0

**References:** [package.json](./.skilld/pkg/package.json) • [README](./.skilld/pkg/README.md) • [Docs](./.skilld/docs/_INDEX.md) • [Issues](./.skilld/issues/_INDEX.md) • [Releases](./.skilld/releases/_INDEX.md)

## Search

Use `skilld search "query" -p skilld` instead of grepping `.skilld/` directories. Run `skilld search --guide -p skilld` for full syntax, filters, and operators.

<!-- skilld:api-changes -->
## API Changes

This section documents version-specific API changes — prioritize recent major/minor releases.

## Breaking Changes (v1 → v2)

- BREAKING: Node engine requirement — v2.0.0 raised minimum to Node 22.x from previously ~18.x [source](./.skilld/releases/v2.0.0.md)

## New Features (v2.0.0+)

- NEW: Cloud integration (auth, protocol, pull) — added in v2.0.0 to support cloud-based skill resolution and authentication [source](./.skilld/releases/v2.0.0.md#features)

- NEW: skilld-protocol v2.3.0 dependency — new protocol layer introduced for standardized skill communication [source](./.skilld/pkg/package.json:L66)

## Bug Fixes (v2.0.0)

- IMPROVED: `styleText` for ANSI output — switched from previous method for better terminal styling in v2.0.0 [source](./.skilld/releases/v2.0.0.md#bug-fixes)

## Earlier v1.x CLI Enhancements

These changes predate v2.0.0 but represent the v1 API surface before the major version bump:

- skilld search command enhancements — added --filter, --limit, --guide flags for full query API in v1.5.0 [source](./.skilld/releases/v1.5.0.md#features)

- skilld prepare command — new hook for package.json integration introduced in v1.5.0 [source](./.skilld/releases/v1.5.0.md#features)

- skilld author command — maintainer skill publishing command added in v1.5.0 [source](./.skilld/releases/v1.5.0.md#features)

- skilld cache command flags — added --stats and --clean flags in v1.6.0 [source](./.skilld/releases/v1.6.0.md#features)

- skilld list --outdated flag — filter skills by version in v1.4.0 [source](./.skilld/releases/v1.4.0.md#features)

- incremental search index updates — v1.3.0 replaced all-or-nothing rebuild with incremental updates [source](./.skilld/releases/v1.3.0.md#features)

- AI OAuth providers + UX rework — authentication flow changes in v1.3.0 [source](./.skilld/releases/v1.3.0.md#features)

- Crate package support — added Rust crate (crates.io) resolution in v1.7.0 [source](./.skilld/releases/v1.7.0.md#features)

- Registry pivot foundations — restructured registry resolution in v1.7.0 [source](./.skilld/releases/v1.7.0.md#features)

## Notes

Skilld is a CLI-first tool; detailed API changes are typically documented in release notes and the README. Consult the releases directory and package README for comprehensive CLI command documentation. The v2.0.0→v2.3.0 migration (current version) was not captured in releases index snapshots; check npm registry or GitHub releases for the latest v2.x changes.
<!-- /skilld:api-changes -->

<!-- skilld:best-practices -->
## Best Practices

- Use `skilld add --global` to install frequently-needed skills globally to `~/<agent>/skills`, centralizing package knowledge across all projects without per-project setup [source](./.skilld/pkg/README.md:L170)

- Optimize embedding search performance on Apple Silicon with `SKILLD_EMBED_DEVICE=webgpu` in skilld config—measured 2.6–2.9× faster indexing than CPU across all model sizes [source](./.skilld/pkg/README.md:L302:L310)

- Choose embedding models based on your tradeoff: `bge-small-en-v1.5` (default, fastest), `bge-base-en-v1.5` (balanced), `Xenova/bge-large-en-v1.5` (highest accuracy). Rebuild indexes after switching with `skilld update` [source](./.skilld/pkg/README.md:L258:L274)

- Ship skills with your npm package by running `skilld author package` from the package root, adding `"skills"` to `package.json` `files` array, then consumers auto-discover via `skilld prepare` [source](./.skilld/pkg/README.md:L365:L390)

- Add `"prepare": "skilld prepare"` to your `package.json` scripts—restores symlinks, auto-installs shipped skills from deps, and notifies when packages have breaking changes on every install [source](./.skilld/pkg/README.md:L103:L112)

- Use `skilld author eject <pkg>` to export a portable, self-contained skill directory for sharing via git repos; consumers install with `skilld add gh:owner/repo` without LLM costs [source](./.skilld/pkg/README.md:L321:L332)

- Validate SKILL.md before publishing with `skilld author validate <file>` to catch structural or content issues early [source](./.skilld/pkg/README.md:L202:L206)

- Use `skilld search` with semantic queries instead of grepping `.skilld/` directories—supports `--filter '{"type":"issue"}'`, `--limit`, and `--agents` for cross-skill searches [source](./.skilld/pkg/README.md:L161:L165)

- Run `skilld update` with the `--force` flag to ignore all caches and re-fetch documentation when docs have changed significantly or you need guaranteed fresh content [source](./.skilld/pkg/README.md:L334:L346)

- Use Ollama locally for free, offline skill enhancement by setting a model like `skilld add npm:vue -m ollama:qwen2.5:14b-instruct` when Ollama is running [source](./.skilld/pkg/README.md:L228:L243)

- Generate skills without an agent CLI by choosing "No agent" during setup, receiving portable prompts (PROMPT_*.md) you can run in any LLM, then assemble outputs with `skilld author assemble` [source](./.skilld/pkg/README.md:L208:L226)

- Use `skilld config` after initial setup to customize agent target, LLM model, embedding model, embedding device, and other preferences centrally [source](./.skilld/pkg/README.md:L184)

- Leverage locally-pulled Ollama embedding models via `SKILLD_EMBED_MODEL=ollama:<name>` for language-specific or custom embeddings without dependency on built-in models [source](./.skilld/pkg/README.md:L276:L289)

- Restrict semantic search to specific agents with `skilld search "query" --agents claude-code,codex` to reduce noise when multiple agents have overlapping skills installed [source](./.skilld/pkg/README.md:L247:L251)
<!-- /skilld:best-practices -->
