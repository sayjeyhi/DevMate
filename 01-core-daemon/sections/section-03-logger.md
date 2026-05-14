Now I have all the context needed. Let me generate the section content for `section-03-logger`.

# Section 03: Logger

## Overview

This section implements the logging subsystem for the jira-assistant daemon. It consists of two files:

- `src/logger/index.ts` — the `createLogger` factory with TTY-adaptive output
- `src/logger/rotate.ts` — size-based log rotation

This section depends on **section-01-foundation** (`shared/paths.ts`, `shared/errors.ts`) and is parallelizable with section-02-config and section-04-launchd. It must be complete before section-05-cli-commands begins.

---

## Dependencies

- **section-01-foundation** must be complete: `shared/paths.ts` provides `PATHS.logFile` and `PATHS.logsDir`; `shared/errors.ts` provides `FriendlyError`
- No other sections are required

---

## Files to Create

```
01-core-daemon/
  src/
    logger/
      index.ts        # createLogger factory, Logger interface
      rotate.ts       # rotateIfNeeded function
  tests/
    logger/
      rotate.test.ts  # all rotation tests
```

There is no separate test file for `logger/index.ts` — logger output tests are written inline in `rotate.test.ts` or a new `index.test.ts` file (either works; keep them in `tests/logger/`).

---

## Tests First

Write these tests before implementing. Test file: `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/01-core-daemon/tests/logger/rotate.test.ts`

Create a second test file for the logger factory at `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/01-core-daemon/tests/logger/index.test.ts`.

### `tests/logger/index.test.ts` — Logger factory tests

```typescript
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { createLogger } from "../../src/logger/index"

describe("createLogger — JSON mode", () => {
  it("each log call writes one valid JSON line with level, ts, msg fields")
  // Capture output, parse as JSON, assert all three keys present

  it("meta object fields are merged into root of log line")
  // createLogger('info', 'json').info('hello', { reqId: '42' })
  // parsed output should have { level, ts, msg, reqId: '42' }
})

describe("createLogger — TTY mode ANSI suppression", () => {
  it("NO_COLOR set → output contains no ANSI escape codes")
  it("CLICOLOR=0 → no ANSI codes")
  it("TERM=dumb → no ANSI codes")
  it("process.stdout.isTTY falsy → no ANSI codes")
})

describe("createLogger — level gating", () => {
  it("debug messages suppressed when level = 'info'")
  // logger.debug('secret') should not appear in output

  it("debug messages emitted when level = 'debug'")
  // logger.debug('visible') should appear in output
})
```

Testing approach for output capture: redirect or wrap the write calls. The simplest approach is to pass an optional `output` stream parameter to `createLogger` in tests, or to spy on `process.stdout.write`. Use `spyOn(process.stdout, "write")` to capture calls without actual I/O.

### `tests/logger/rotate.test.ts` — Rotation tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { rotateIfNeeded } from "../../src/logger/rotate"
import { mkdtemp, writeFile, readFile, stat, unlink } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

// Each test uses a fresh temp directory

describe("rotateIfNeeded", () => {
  it("file size below maxBytes → no rotation, original file unchanged")
  // Write a small file; call rotateIfNeeded with large maxBytes; verify app.log.1 does not exist

  it("file size at/above maxBytes → app.log.1 created with original content")
  // Write file >= maxBytes; call rotateIfNeeded; verify app.log.1 has original content; app.log is empty/reset

  it("second rotation → app.log.1 becomes app.log.2, new app.log.1 has previous app.log content")
  // Simulate two rotations; check shift chain

  it("when keepCount files exist → oldest file deleted, others shifted")
  // Pre-create app.log.1 through app.log.<keepCount>; trigger rotation; verify app.log.<keepCount+1> does NOT exist

  it("non-existent log file → no-op, no error thrown")
  // Call rotateIfNeeded on a path that does not exist; expect it to resolve without throwing
})
```

All tests use a real temp directory (no mocks for file I/O). Use `mkdtemp(join(tmpdir(), "ja-test-"))` to create isolated directories. Clean up in `afterEach`.

---

## Implementation Details

### `src/logger/index.ts`

**Interface:**

```typescript
export interface Logger {
  info(msg: string, meta?: object): void
  error(msg: string, meta?: object): void
  warn(msg: string, meta?: object): void
  debug(msg: string, meta?: object): void
}

/**
 * Creates a logger instance.
 * - level: gates which messages are emitted ('debug' emits all; 'info' suppresses debug; 'error' suppresses debug+info+warn)
 * - mode: 'tty' for human-readable colored output, 'json' for newline-delimited JSON.
 *         Auto-detected from process.stdout.isTTY if not specified.
 */
export function createLogger(
  level: "info" | "debug" | "error",
  mode?: "tty" | "json"
): Logger
```

**Mode auto-detection:**

If `mode` is not passed, derive it:

```typescript
const effectiveMode = mode ?? (process.stdout.isTTY ? "tty" : "json")
```

**JSON mode format:**

Each method call emits exactly one line to `process.stdout`:

```json
{ "level": "info", "ts": "2025-01-01T00:00:00.000Z", "msg": "...", ...meta }
```

- `ts` is `new Date().toISOString()`
- `meta` fields (if provided) are spread into the root object, not nested
- Use `JSON.stringify(...)` followed by a single `\n` write — one `process.stdout.write()` call per log entry

**TTY mode format:**

```
[INFO] message  { meta: value }
```

- Level label is padded or color-coded using ANSI codes
- Colors: `info` → default/white, `warn` → yellow (`\x1b[33m`), `error` → red (`\x1b[31m`), `debug` → dim (`\x1b[2m`)
- Reset code: `\x1b[0m`

**ANSI color suppression — check ALL four conditions:**

Colors must be suppressed (even in TTY mode) if any of the following is true:

1. `process.env.NO_COLOR !== undefined` (any value, including empty string)
2. `process.env.CLICOLOR === "0"`
3. `process.env.TERM === "dumb"`
4. `!process.stdout.isTTY`

Compute `const useColor = <boolean>` once at logger creation time based on these conditions. Do not re-check on every log call.

**Level gating:**

Define a numeric priority map:

```typescript
const LEVEL_PRIORITY = { debug: 0, info: 1, warn: 2, error: 3 }
```

A message is emitted only if `LEVEL_PRIORITY[messageLevel] >= LEVEL_PRIORITY[configuredLevel]`. This means:
- `level = "info"` suppresses `debug`
- `level = "error"` suppresses `debug`, `info`, `warn`
- `level = "debug"` emits everything

---

### `src/logger/rotate.ts`

**Function signature:**

```typescript
/**
 * Rotates logFile if its size exceeds maxBytes.
 * Shifts existing rotated files: app.log.1 → app.log.2, ..., up to keepCount.
 * Deletes files beyond keepCount.
 * No-op if logFile does not exist.
 *
 * @param logFile   Absolute path to the active log file
 * @param maxBytes  Size threshold in bytes. Default: 10 * 1024 * 1024 (10MB)
 * @param keepCount Maximum number of rotated files to retain. Default: 5
 */
export async function rotateIfNeeded(
  logFile: string,
  maxBytes?: number,
  keepCount?: number
): Promise<void>
```

**Rotation algorithm (step by step):**

1. Check `Bun.file(logFile).size`. If the file does not exist, `Bun.file().size` returns `0` — but also verify existence via `Bun.file(logFile).exists()` to handle the no-op case cleanly.
2. If `size < maxBytes`, return immediately.
3. Shift rotated files from highest index down to 1:
   - For `i = keepCount` down to `2`: if `app.log.<i-1>` exists, rename it to `app.log.<i>`. Delete `app.log.<keepCount+1>` if it somehow exists.
   - Then rename `app.log` → `app.log.1`
4. Write an empty file at `logFile` (or simply rely on the next log write to create it).

Use the Node.js `fs/promises` `rename` for atomic moves. Use `Bun.write(logFile, "")` to create the fresh empty log file after rotation.

**File descriptor ownership note:**

The daemon writes directly to `app.log` using a file writer opened once at startup. After rotation, the daemon must re-open its writer to the new (empty) `app.log`. The rotation function itself does not manage file descriptors — it only manipulates files on disk. The caller (`daemon.ts`) is responsible for closing and re-opening the writer after `rotateIfNeeded` resolves. This is by design: launchd does NOT capture stdout/stderr for the daemon process (no `StandardOutPath`/`StandardErrorPath` in the plist), so the daemon owns the file descriptor exclusively.

**Calling pattern in daemon:**

`rotateIfNeeded` is called:
- Once on daemon startup (before the polling loop begins)
- Periodically via `setInterval(rotateIfNeeded, 60 * 60 * 1000)` — every hour

This is handled in `commands/daemon.ts` (section-05), not in the logger itself.

---

## Exports

`src/logger/index.ts` must export:

```typescript
export type { Logger }
export { createLogger }
```

These exports are consumed by:
- `commands/daemon.ts` (section-05)
- Downstream modules `02-integration-clients` and `03-command-handlers` (outside this module, via the interface contract documented in section-07 of the plan)

`src/logger/rotate.ts` must export:

```typescript
export { rotateIfNeeded }
```

Consumed only by `commands/daemon.ts`.

---

## Implementation Checklist

1. Create directory `src/logger/` and `tests/logger/`
2. Write test stubs in `tests/logger/index.test.ts` and `tests/logger/rotate.test.ts`
3. Run `bun test tests/logger/` — all tests should fail (not error)
4. Implement `src/logger/index.ts`:
   - Define `Logger` interface
   - Implement `createLogger` with JSON and TTY branches
   - Compute `useColor` once at creation time
   - Implement `LEVEL_PRIORITY` gating
5. Run logger tests — verify JSON mode, ANSI suppression, and level gating pass
6. Implement `src/logger/rotate.ts`:
   - Implement `rotateIfNeeded` with existence check, shift loop, and fresh file creation
7. Run rotation tests — verify all five rotation scenarios pass
8. Run `bun test` from project root to confirm no regressions

## Actual Implementation Notes

**Files created:**
- `01-core-daemon/src/logger/index.ts` — Logger interface + createLogger factory (61 lines)
- `01-core-daemon/src/logger/rotate.ts` — rotateIfNeeded (28 lines)
- `01-core-daemon/tests/logger/index.test.ts` — 9 tests covering JSON mode, ANSI suppression, level gating
- `01-core-daemon/tests/logger/rotate.test.ts` — 5 tests covering all rotation scenarios

**Deviations from plan:**
- `rotate.ts`: Used `stat` from `fs/promises` instead of `Bun.file().size` and `Bun.file().exists()` — `Bun.File.size` is a lazy property that may return 0 before file is opened in Bun 1.3; `stat` is more reliable
- `rotate.ts`: Used `unlink` from `fs/promises` instead of `Bun.file(path).delete?.()` — `Bun.file().delete()` is not stable in Bun 1.3; the `?.` would silently no-op
- `tests/logger/index.test.ts`: isTTY test saves/restores full property descriptor via `Object.getOwnPropertyDescriptor` instead of plain value restore to preserve getter semantics

**Test results:** 13 tests pass (all logger tests), 44 total pass with no regressions.