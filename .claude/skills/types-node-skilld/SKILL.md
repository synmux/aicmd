---
name: types-node-skilld
description: "TypeScript definitions for node. ALWAYS use when writing code importing \"@types/node\". Consult for debugging, best practices, or modifying @types/node, types/node, types node, DefinitelyTyped."
metadata:
  version: 26.2.0
  generated_by: cached
  generated_at: 2026-08-18
---

# DefinitelyTyped/DefinitelyTyped `@types/node@26.2.0`
**Tags:** ts2.7: 12.12.6, ts2.5: 12.12.6, ts2.2: 12.12.6

**References:** [package.json](./.skilld/pkg/package.json) • [README](./.skilld/pkg/README.md) • [Issues](./.skilld/issues/_INDEX.md) • [Discussions](./.skilld/discussions/_INDEX.md) • [Releases](./.skilld/releases/_INDEX.md)

## Search

Use `skilld search "query" -p @types/node` instead of grepping `.skilld/` directories. Run `skilld search --guide -p @types/node` for full syntax, filters, and operators.

<!-- skilld:api-changes -->
## API Changes

This section documents version-specific API changes in @types/node v26.x — prioritize recent versions for code compatibility.

### Major Additions (v26.1–v26.2)

- NEW: `node:ffi` module — foreign function interface for loading and calling native libraries [source](./.skilld/pkg/ffi.d.ts:L1)
  - `dlopen(filename, symbols)` — load a dynamic library with typed symbol bindings
  - `dlclose(handle)` — close a library handle
  - `dlsym(handle, symbol)` — resolve a symbol address to bigint
  - `DynamicLibrary` class with `close()`, `getSymbol()`, and symbol access
  - `DynamicLibraryResult<T>` type for strongly-typed library symbols
  - Supports `using` syntax for automatic cleanup

- NEW: `crypto.randomUUID(options)` in v26.1 — generate cryptographically secure UUIDs with precision Unix timestamp in the most significant 48 bits [source](./.skilld/pkg/crypto.d.ts:L1)

- NEW: `QuicSession` callback types in v26.2 (node:quic module):
  - `OnNewTokenCallback` — handles new token events with token buffer and peer address [source](./.skilld/pkg/quic.d.ts:L58:L60)
  - `OnOriginCallback` — handles origin list updates from server [source](./.skilld/pkg/quic.d.ts:L62:L64)
  - `OnKeylogCallback` — receives TLS key material for debugging (when `sessionOptions.keylog = true`) [source](./.skilld/pkg/quic.d.ts:L70:L72)
  - `OnQlogCallback` — emits qlog diagnostic data chunks (when `sessionOptions.qlog = true`) [source](./.skilld/pkg/quic.d.ts:L78:L81)
  - `OnHeadersCallback` — receives initial request/response HTTP/3 headers [source](./.skilld/pkg/quic.d.ts:L94:L96)
  - `OnTrailersCallback` — receives trailing headers from peer [source](./.skilld/pkg/quic.d.ts:L100:L101)
  - `OnInfoCallback` — receives informational (1xx) headers, e.g., 103 Early Hints [source](./.skilld/pkg/quic.d.ts:L105:L107)

- NEW: `BoundedChannel` class in diagnostics_channel (v26.1) — tracing channel with automatic store scope management [source](./.skilld/pkg/diagnostics_channel.d.ts:L1)
  - `boundedChannel(config)` — factory function creating channels with start/end handlers
  - `RunStoresScope` — disposable scope for async context isolation
  - `withStoreScope(data)` — create isolated scope (use `using` for auto-disposal)
  - `subscribe(handlers)` / `unsubscribe(handlers)` — manage event handlers
  - `run(context, callback)` — execute operation within bounded scope

- NEW: `database.serialize()` and `database.deserialize(buffer)` in node:sqlite (v26.1) — snapshot database state to binary for cloning [source](./.skilld/pkg/sqlite.d.ts:L1)

- NEW: HTTP informational response support (v26.2):
  - `response.writeInformation(status, headers)` — send 1xx informational headers (e.g., 100 Continue, 103 Early Hints) [source](./.skilld/pkg/http.d.ts:L1)

- NEW: V8 heap profiling in v26.1 — synchronous heap snapshot collection:
  - `v8.startHeapSnapshot(options)` → `SyncHeapProfileHandle`
  - `handle.stop()` — retrieve profile data; `handle.dispose()` — discard [source](./.skilld/pkg/v8.d.ts:L1)

- NEW: Test runner enhancements (v26.1–v26.2):
  - `testContext.tags` property (v26.2) — frozen array of flattened, lowercased test tags [source](./.skilld/pkg/test.d.ts:L1)
  - `testContext.passed` property (v26.1) — boolean for suite pass status [source](./.skilld/pkg/test.d.ts:L1)
  - `testContext.attempt` property (v26.2) — zero-based attempt number for `--test-rerun-failures` [source](./.skilld/pkg/test.d.ts:L1)
  - `options.shard` in test runner (v26.2) — parallel shard execution spec `{ index, total }` [source](./.skilld/pkg/test.d.ts:L1)

### Deprecated & Removed

- DEPRECATED: `readline` module default export alias — use `import { Interface } from 'node:readline'` instead [source](./.skilld/pkg/readline.d.ts:L1)

- DEPRECATED: `crypto.KeyLike` type — replace with `KeyLike` from crypto module directly [source](./.skilld/pkg/crypto.d.ts:L1)

- DEPRECATED: `punycode` module (since v7.0.0) — built-in bundled version is being removed; use npm package instead [source](./.skilld/pkg/punycode.d.ts:L1)

- DEPRECATED: `util.types.isNativeError()` (v26.1) — use `Error.isError()` instead [source](./.skilld/pkg/util/types.d.ts:L1)

**Also changed:** `BoundedChannel.subscribe` and `.unsubscribe` in diagnostics_channel (v26.1) · `QuicStream` header events (v26.2) · `tls` deprecated methods · `vm.Script.cachedData` renamed to `createCachedData()`
<!-- /skilld:api-changes -->

<!-- skilld:best-practices -->
## Best Practices

- Import from the `node:` protocol prefix (e.g., `import fs from 'node:fs'`) instead of bare package names — enables clearer intent, better tooling support, and future-proofs against conflicts [source](./.skilld/pkg/index.d.ts:L1:35)

- Use `stream/promises.pipeline()` for composing multiple stream transformations with automatic error handling and cleanup — safer than manual `.pipe()` chaining [source](./.skilld/pkg/stream/promises.d.ts:L66:L140)

- Enable `captureRejections: true` on `EventEmitter` subclasses that emit promises to automatically handle unhandled promise rejections via the `Symbol.for('nodejs.rejection')` method [source](./.skilld/pkg/events.d.ts:L54:L90)

- Use `stream/promises.finished()` with `{ cleanup: true }` option to remove dangling event listeners after stream completion — prevents memory leaks and unexpected errors from stray 'error' events [source](./.skilld/pkg/stream/promises.d.ts:L31:L48)

- Prefer `fs/promises` APIs for async file operations over callback-based equivalents — enables cleaner async/await code and better error propagation [source](./.skilld/pkg/fs/promises.d.ts:L1:L50)

- Never pass unsanitized user input to `child_process.exec()` — shell metacharacters can trigger arbitrary command execution; use `spawn()` or validate inputs strictly [source](./.skilld/pkg/child_process.d.ts:L420:L450)

- Pass an `AbortSignal` to cancellable APIs (streams, timers, subprocess operations) for clean shutdown and resource cleanup — cancellation via `AbortController` propagates automatically to all signal listeners [source](./.skilld/pkg/stream/promises.d.ts:L73:L100)

- Use `timers/promises` module for async delays and intervals (e.g., `await setTimeout(delay)`) instead of callback-based timers — integrates seamlessly with async/await and generator loops [source](./.skilld/pkg/timers/promises.d.ts:L1:L85)

- Configure `stdio` overloads explicitly when spawning child processes (via `SpawnOptions.stdio`) to match expected stdin/stdout/stderr types — enables TypeScript to infer correct stream types (`Readable`, `Writable`, or `null`) [source](./.skilld/pkg/child_process.d.ts:L50:L120)

- Use `EventEmitter` generic type parameter (`EventEmitter<T extends EventMap<T>>`) to provide full type-safe event listener registration — avoids untyped `(...args: any[])` fallbacks [source](./.skilld/pkg/events.d.ts:L1:L60)

- Do not rely on `@types/node` for ES builtin types (e.g., `Iterator.filter()`, `AsyncIterator`); add TypeScript `lib` settings instead (e.g., `"lib": ["es2025.iterator"]` for v26 features) — @types/node only provides Node-specific APIs, ES builtins come from TypeScript's standard library [source](./.skilld/discussions/discussion-74956.md:L24:L36)

- Use `Worker` class with named `threadName` option (available since v24.6.0) for easier debugging and monitoring of worker thread lifecycle — thread names are visible in profilers and log output [source](./.skilld/pkg/worker_threads.d.ts:L80:L110)

- Leverage readonly stream properties (`stdin`, `stdout`, `stderr` on `ChildProcess`, `Worker`) to enforce immutability and prevent accidental reassignment — signals intent that stream references are managed by the runtime [source](./.skilld/pkg/child_process.d.ts:L190:L230)
<!-- /skilld:best-practices -->
