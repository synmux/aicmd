---
name: prettier-skilld
description: "Prettier is an opinionated code formatter. ALWAYS use when writing code importing \"prettier\". Consult for debugging, best practices, or modifying prettier."
metadata:
  version: 3.9.6
  generated_by: cached
  generated_at: 2026-08-18
---

# prettier/prettier `prettier@3.9.6`
**Tags:** next: 4.0.0-alpha.13, latest: 3.9.6

**References:** [package.json](./.skilld/pkg/package.json) • [README](./.skilld/pkg/README.md) • [Docs](./.skilld/docs/_INDEX.md) • [Issues](./.skilld/issues/_INDEX.md) • [Discussions](./.skilld/discussions/_INDEX.md) • [Releases](./.skilld/releases/_INDEX.md)

## Search

Use `skilld search "query" -p prettier` instead of grepping `.skilld/` directories. Run `skilld search --guide -p prettier` for full syntax, filters, and operators.

<!-- skilld:api-changes -->
## API Changes

This section documents version-specific API changes — prioritize recent major/minor releases.

- BREAKING: `printer.preprocess` — missing type definition added in v3.0.1, now part of `Printer<T>` interface [source](./.skilld/releases/CHANGELOG.md:L1724)

- NEW: `printer.getVisitorKeys()` — new method added in v3.0.1 for custom AST traversal `getVisitorKeys(node, nonTraversableKeys)` [source](./.skilld/releases/CHANGELOG.md:L1732)

- BREAKING: `printers` property — missing from type definitions in v3.8.0, restored in v3.8.1 for `prettier/plugins/estree` [source](./.skilld/releases/CHANGELOG.md:L518)

- BREAKING: `comment.placement` property — undocumented property deleted in v3.9.0, restored in v3.9.5 after breaking plugins [source](./.skilld/releases/CHANGELOG.md:L152)

- BREAKING: `cursorOffset` option — documentation falsely claimed incompatibility with `rangeStart`/`rangeEnd` until v3.1.1, but has been compatible for 5+ years [source](./.skilld/releases/CHANGELOG.md:L1433)

- NEW: Import Attributes support — added in v3.1.1 for `import ... with { type: "json" }` syntax (TypeScript 5.3+) [source](./.skilld/releases/CHANGELOG.md:L1425)

- NEW: `using` / `await using` declarations — added in v3.0.3 for Explicit Resource Management (TypeScript 5.2+) [source](./.skilld/releases/CHANGELOG.md:L1539)

- BREAKING: Cache format — changed in v3.5.0, crashes on read of old v3.4 cache files, fixed in v3.5.1 [source](./.skilld/releases/CHANGELOG.md:L783)

- NEW: `@let` declaration syntax — added in v3.3.3 for Angular v18+ template variables [source](./.skilld/releases/CHANGELOG.md:L980)

- DEPRECATED: `--shared-config` behavior — config packages without `require` export fail in v3.0.2, fixed in v3.0.3 to use ESM exports [source](./.skilld/releases/CHANGELOG.md:L1485)

**Also changed:** JSON parser inference for `tsconfig.json` changed v3.2.5 · `module-sync` condition removed v3.5.2 · `require("prettier")` still uses CommonJS v3.5.2 · Symbolic link following disabled v3.0+ (controlled with `--no-error-on-unmatched-pattern` in v3.1.1) · JSDoc comments on decorators fixed v3.4.2 · TypeScript 5.0 `const` modifiers v2.8.5 · TypeScript 5.0 `export type *` v2.8.5 · Auto accessors v2.8.1 · Decorators on private members v2.8.6 · Angular v18 support v3.3.3
<!-- /skilld:api-changes -->

<!-- skilld:best-practices -->
## Best Practices

- Use `prettier.resolveConfig()` with `useCache: false` in editor integrations when the file system may change — prevents stale configuration being served from cache [source](./.skilld/docs/api.md#prettierresolveconfigfileUrlOrPath--options)

- Use `prettier.formatWithCursor()` instead of `format()` when building editor integrations — preserves cursor position during formatting and improves user experience [source](./.skilld/docs/api.md#prettierformatwithcursorsource--options)

- Reach for `@prettier/sync` for synchronous formatting when async is not feasible — the official synchronous wrapper prevents code blocking and error handling issues [source](./.skilld/docs/api.md:L12)

- Never place the `parser` option at the configuration file's top level — always nest it inside `overrides` blocks to preserve Prettier's automatic parser inference [source](./.skilld/docs/configuration.md:L206)

- Use `import { type Config } from "prettier"` in TypeScript configuration files for type checking — catches option mismatches at edit time [source](./.skilld/docs/configuration.md:L92:L99)

- Create `.editorconfig` files in projects using Prettier — Prettier automatically reads and respects them, ensuring consistency with non-JavaScript editors [source](./.skilld/docs/configuration.md:L212:L253)

- Implement `getVisitorKeys()` in plugin printers when ASTs contain cycles or non-traversable properties — prevents infinite recursion and improves performance [source](./.skilld/docs/plugins.md:L345:L390)

- Return async functions from the `embed()` method for embedded language formatting — async work is queued and executed sequentially, enabling CSS-in-JS and fenced code block formatting [source](./.skilld/docs/plugins.md:L310:L315)

- Define `preprocess()` in parsers (supports async as of v3.7.0) to normalize input before parsing — enables text transformation without modifying the AST [source](./.skilld/docs/plugins.md:L169:L175)

- Always quote glob patterns on the CLI (`prettier "src/**/*.js"`) instead of relying on shell expansion — ensures cross-platform consistency and correct file matching [source](./.skilld/docs/cli.md:L38)

- Put formatting options in a configuration file rather than passing CLI flags — this ensures consistency across the CLI, editor integrations, and programmatic usage [source](./.skilld/docs/cli.md:L44)

- Use `eslint-config-prettier` to disable conflicting ESLint rules instead of running Prettier inside the linter — avoids visual noise, improves performance, and simplifies tooling [source](./.skilld/docs/integrating-with-linters.md:L8:L29)

- Use `lint-staged` for pre-commit hooks when combining Prettier with other code quality tools — supports both entire-file and partially-staged file formatting [source](./.skilld/docs/precommit.md:L11:L13)

- Include Prettier in `peerDependencies` when publishing a shareable config package — allows consumers to choose their own Prettier version while avoiding duplication [source](./.skilld/docs/sharing-configurations.md:L203)
<!-- /skilld:best-practices -->
