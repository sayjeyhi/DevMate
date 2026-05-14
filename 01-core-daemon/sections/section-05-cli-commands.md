Now I have all the context needed. Let me generate the section content.

# Section 05: CLI Commands

## Overview

This section implements all CLI commands that tie together the config, logger, launchd, and daemon subsystems into a user-facing interface. It depends on sections 01 through 04 being complete.

**Dependencies (must be complete before starting this section):**
- section-02-config: `loadConfig`, `configExists`, `writeConfig`, `runWizard`, `AppConfig`
- section-03-logger: `createLogger`, `rotateIfNeeded`
- section-04-launchd: `agentStatus`, `loadAgent`, `unloadAgent`, `writePlist`, `readPid`, `removePid`, `RestartTracker`
- section-01-foundation: `FriendlyError`, `LaunchctlError`, `PATHS`

**Runtime:** Bun. Test runner: `bun test`.

---

## Files to Create

```
01-core-daemon/
  src/
    index.ts
    commands/
      start.ts
      stop.ts
      status.ts
      config.ts
      daemon.ts
  tests/
    commands/
      start.test.ts
      stop.test.ts
      status.test.ts
      config.test.ts
      daemon.test.ts
```

---

## Tests First

All tests mock external calls. No real launchd interaction, no real file I/O for launchctl, no real TTY. Tests live in `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/01-core-daemon/tests/commands/`.

### `tests/commands/start.test.ts`

```typescript
import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test"

describe("preflight()", () => {
  it("throws FriendlyError mentioning macOS when running on Linux")
  it("creates ~/Library/LaunchAgents dir when missing")
  it("throws FriendlyError when claude binary path is not executable")
})

describe("startCommand()", () => {
  it("triggers wizard flow when no config exists (mocks runWizard and writeConfig)")
  it("calls stopCommand first when daemon is already running")
  it("calls writePlist with realpathSync(Bun.argv[0]), not process.execPath directly")
  it("polls agentStatus until running (not-running for first 2 polls, then running)")
  it("exits with failure message after 5s timeout if never reaches running state")
})
```

### `tests/commands/stop.test.ts`

```typescript
import { describe, it, expect, mock } from "bun:test"

describe("stopCommand()", () => {
  it("calls unloadAgent() then removePid() in order")
  it("surfaces friendly error message when unloadAgent throws LaunchctlError")
})
```

### `tests/commands/status.test.ts`

```typescript
import { describe, it, expect, mock } from "bun:test"

describe("statusCommand()", () => {
  it("output contains 'running' and PID when daemon is running")
  it("output contains 'stopped' when daemon is not running")
  it("skips config section but still shows launchd state when no config file exists")
})
```

### `tests/commands/config.test.ts`

```typescript
import { describe, it, expect, mock } from "bun:test"

describe("configCommand()", () => {
  it("runs wizard with no existing argument when config does not exist")
  it("runs wizard pre-filled with existing values when config exists (mocks loadConfig)")
  it("calls writeConfig with the wizard result on completion")
})
```

### `tests/commands/daemon.test.ts`

```typescript
import { describe, it, expect, mock, spyOn } from "bun:test"

describe("daemonCommand()", () => {
  it("calls shutdownController.abort() on SIGTERM (mocks polling loop entry)")
  it("calls restartTracker.recordRestart() and re-throws when unhandled crash is under limit")
  it("calls process.exit(0) when restartTracker.recordRestart() returns true (limit exceeded)")
  it("calls rotateIfNeeded() before starting the polling loop")
})
```

---

## Implementation Details

### `src/index.ts` — Entry Point

Uses `citty`'s `defineCommand` and `runMain`. Registers all subcommands as lazy async imports so the compiled binary does not load all modules upfront.

The `version` string is read from `package.json` injected at build time via `--define` (e.g., `--define:__VERSION__='"1.0.0"'`). Both `jira-assistant` and `ja` share this same entry point.

```typescript
// Stub — implementer fills in subcommand registrations
import { defineCommand, runMain } from "citty"

const main = defineCommand({
  meta: { name: "jira-assistant", version: __VERSION__, description: "..." },
  subCommands: {
    start: () => import("./commands/start").then(m => m.default),
    stop:  () => import("./commands/stop").then(m => m.default),
    status: () => import("./commands/status").then(m => m.default),
    config: () => import("./commands/config").then(m => m.default),
    daemon: () => import("./commands/daemon").then(m => m.default),
  },
})

runMain(main)
```

All `FriendlyError` instances are caught at the top level: print `error.message` and, if present, `error.hint` to stderr, then `process.exit(1)`.

---

### `commands/start.ts`

```typescript
/** Verifies macOS platform, LaunchAgents dir exists, and claude binary is executable. */
async function preflight(): Promise<void>

/** Runs the full start flow: preflight, config check, stop-if-running, writePlist, loadAgent, poll. */
export async function startCommand(): Promise<void>
```

**Detailed flow:**

1. **`preflight()`**
   - If `process.platform !== "darwin"` → throw `FriendlyError("jira-assistant requires macOS", ...)`
   - If `~/Library/LaunchAgents` directory does not exist → create it with `Bun.mkdir` (not an error)
   - Load config and check `config.claude.binary_path` is an executable file. If not → throw `FriendlyError`

2. Check `configExists()` → if false, call `runWizard()` with no argument, then `writeConfig(result)`

3. Check `agentStatus()` → if `running == true`, print a status message then call `stopCommand()`

4. Call `writePlist(realpathSync(Bun.argv[0]))`. The argument must be `realpathSync(Bun.argv[0])` — not `process.execPath` — because `Bun.argv[0]` resolves to the compiled binary path correctly in the built artifact.

5. Call `loadAgent()`

6. Poll `agentStatus()` every 200ms for up to 5 seconds. When `running == true`, print success with PID. If the 5-second timeout is exceeded, print a failure message including the last known `exitCode` from the status, along with a hint to check `jira-assistant status` or the log file, then `process.exit(1)`.

---

### `commands/stop.ts`

```typescript
/** Unloads the launchd agent and removes the PID file. */
export async function stopCommand(): Promise<void>
```

**Detailed flow:**

1. Call `unloadAgent()`. Catch any `LaunchctlError` and rethrow as a `FriendlyError` with a helpful message.
2. Call `removePid()`
3. Print a confirmation message to stdout.

---

### `commands/status.ts`

```typescript
/** Prints current daemon state, PID, uptime, and config summary to stdout. */
export async function statusCommand(): Promise<void>
```

**Detailed flow:**

1. Call `agentStatus()` and `readPid()` concurrently.
2. Attempt to load config via `loadConfig()`. Catch any error — if config is missing or invalid, proceed with `config = null`.
3. Compute uptime: attempt to derive from `launchctl print` start-time field; fall back to PID file `mtime` using `Bun.file(PATHS.pidFile).stat()`.
4. Print the following format to stdout:

```
jira-assistant status
  State:       running          (or: stopped)
  PID:         12345            (omit line if not running)
  Uptime:      2h 14m           (omit line if not running)
  Config:      ~/.config/jira-assistant/config.toml
  Jira URL:    https://myorg.atlassian.net   (omit if no config)
  Project:     ENG                           (omit if no config)
  Log:         ~/.config/jira-assistant/logs/app.log
```

Use `~`-prefixed display paths (replace `os.homedir()` with `~`) for readability. The actual path constants from `PATHS` are absolute; only the display strings are shortened.

---

### `commands/config.ts`

```typescript
/** Loads existing config (if any), runs the interactive wizard, and writes the result. */
export async function configCommand(): Promise<void>
```

**Detailed flow:**

1. Attempt `loadConfig()`. If it throws (file missing or invalid), set `existing = undefined`.
2. Call `runWizard(existing)` — the wizard pre-fills fields from `existing` when provided.
3. Call `writeConfig(result)`.
4. Print: `Config written to <PATHS.configFile>`.

The wizard is not called with `existing` if config does not exist — pass `undefined` so the wizard starts fresh.

---

### `commands/daemon.ts`

```typescript
/** Long-running entry point used by launchd. Never called directly by users. */
export async function daemonCommand(): Promise<void>
```

This is what launchd invokes. It must never exit unless shut down intentionally or after exceeding the restart limit.

**Detailed flow:**

1. Create the logger using `createLogger(config.app.log_level)` — auto-detects TTY vs JSON mode. Since launchd does not attach a TTY, this always resolves to JSON mode.
2. Instantiate `RestartTracker` pointing at `PATHS.restartsFile` with `maxRestarts = 10`, `windowMs = 60_000`.
3. Load and validate config via `loadConfig()`. On `FriendlyError`, log the error and `process.exit(1)` with a message — do not crash.
4. Write PID file: `writePid(process.pid)`.
5. Create `shutdownController = new AbortController()`. Register a `SIGTERM` handler:
   ```
   process.on("SIGTERM", async () => {
     shutdownController.abort()
     // await graceful polling loop drain
     await removePid()
     logger.info("shutdown complete")
     process.exit(0)
   })
   ```
6. Call `rotateIfNeeded(PATHS.logFile)` at startup.
7. Schedule `setInterval(() => rotateIfNeeded(PATHS.logFile), 60 * 60 * 1000)` — runs every hour.
8. Import and invoke the Telegram polling loop from `02-integration-clients` as a **static import** (not dynamic). Pass `shutdownController.signal` to the polling loop for graceful abort. The polling loop must accept an `AbortSignal` parameter — this is the contract this daemon establishes with the integration module.
9. Wrap the polling loop call in a `try/catch`. On any unhandled error:
   - Call `await restartTracker.recordRestart()`
   - If it returns `true` (limit exceeded): log a warning that the restart limit has been reached, then `process.exit(0)` — launchd will NOT restart because `KeepAlive.SuccessfulExit = false`
   - If it returns `false` (still under limit): re-throw the error — launchd will restart because `KeepAlive.Crashed = true`

**Important note on static imports:** In `bun build --compile`, all `import` statements are bundled at build time. `daemon.ts` must use a top-level `import` for the polling loop, not a `await import(...)`. Dynamic imports at runtime are not possible in compiled Bun binaries.

---

## Key Design Constraints

**`writePlist` argument:** Always call `writePlist(realpathSync(Bun.argv[0]))` from `start.ts`. The `realpathSync` call resolves symlinks. Using `process.execPath` directly has been observed to resolve unexpectedly in some Bun compiled binary scenarios. This is a deliberate choice documented in the plan.

**Restart limit exit strategy:** The daemon exits with code `0` when the restart limit is exceeded. The plist's `KeepAlive` is in dictionary form `{ SuccessfulExit = false; Crashed = true }`. This means:
- `exit(0)` (clean exit) → launchd does NOT restart
- `exit(non-zero)` or crash → launchd DOES restart

This is why `RestartTracker` returning `true` triggers `process.exit(0)` and not a re-throw.

**SIGTERM flow:** On receiving SIGTERM, the daemon must:
1. Signal the polling loop to stop via `shutdownController.abort()`
2. Wait for in-flight Telegram API requests to complete
3. Remove the PID file
4. Log the shutdown
5. Exit 0

The `AbortSignal` is how the polling loop (in `02-integration-clients`) knows to stop cleanly. The daemon must await the polling loop's clean shutdown promise before calling `removePid`.

**Platform guard:** `preflight()` in `start.ts` must reject Linux (and Windows) immediately with a clear error. The daemon only supports macOS (launchd requirement).

---

## Dependencies Reference

The following are provided by completed sections. Do not re-implement:

| Symbol | Source file | Section |
|---|---|---|
| `PATHS` | `shared/paths.ts` | 01-foundation |
| `FriendlyError`, `LaunchctlError` | `shared/errors.ts` | 01-foundation |
| `loadConfig`, `configExists`, `writeConfig` | `config/loader.ts` | 02-config |
| `runWizard` | `config/wizard.ts` | 02-config |
| `AppConfig` | `config/schema.ts` | 02-config |
| `createLogger` | `logger/index.ts` | 03-logger |
| `rotateIfNeeded` | `logger/rotate.ts` | 03-logger |
| `generatePlist`, `writePlist`, `loadAgent`, `unloadAgent`, `agentStatus` | `daemon/launchd.ts` | 04-launchd |
| `writePid`, `readPid`, `removePid`, `isProcessRunning` | `daemon/pid.ts` | 04-launchd |
| `RestartTracker` | `daemon/restart-tracker.ts` | 04-launchd |

---

## Implementation Checklist

- [x] Write test stubs in `tests/commands/start.test.ts`, `stop.test.ts`, `status.test.ts`, `config.test.ts`, `daemon.test.ts`
- [x] Implement `commands/start.ts`: `preflight()` + `startCommand()`
- [x] Implement `commands/stop.ts`: `stopCommand()`
- [x] Implement `commands/status.ts`: `statusCommand()` with uptime calculation
- [x] Implement `commands/config.ts`: `configCommand()`
- [x] Implement `commands/daemon.ts`: `daemonCommand()` with `AbortController`, restart tracker, log rotation
- [x] Implement `src/index.ts`: citty entry point with lazy subcommand registration and `--version`
- [x] Run `bun test tests/commands/` — all 20 tests pass
- [ ] Verify `src/index.ts` compiles without errors (`bun build src/index.ts`)

## Actual Implementation Notes

### Files Created
- `src/commands/start.ts` — `preflight()` uses `node:fs/promises` `access`+`mkdir`; catches only `FriendlyError` from config load to allow fresh-start flow
- `src/commands/stop.ts` — wraps `LaunchctlError` into `FriendlyError` (uses `err.message` not `err.hint` for the message to avoid double-hint)
- `src/commands/status.ts` — concurrent `agentStatus()`+`readPid()`; uptime from `Bun.file(PATHS.pidFile).stat().mtimeMs`
- `src/commands/config.ts` — passes `existing` as `undefined` when config missing (wizard starts fresh)
- `src/commands/daemon.ts` — key deviations from plan:
  - `pollingPromise` initialised to `Promise.resolve()` (closes SIGTERM race where signal fires before `startPolling` called)
  - `rotateIfNeeded` called BEFORE `process.on("SIGTERM", ...)` is registered
  - `setInterval` handle stored as `rotateInterval`; `clearInterval(rotateInterval)` called in SIGTERM handler
  - Crash under restart limit now calls `process.exit(1)` (explicit, not implicit unhandled rejection)
- `src/index.ts` — lazy citty subcommands via `() => import(...).then(m => m.default)` 
- `02-integration-clients/src/index.ts` — stub resolves on `signal` abort (not an infinite promise)

### Test Notes (20 tests, 5 files)
- `mock.module` calls must appear BEFORE the imported module under test due to Bun's shared module cache across test files in the same process
- Cross-file mock contamination avoided by NOT mocking `../../src/commands/stop` in `start.test.ts`; instead verified via `unloadAgentMock` in the shared launchd mock
- `start.test.ts` uses `Object.defineProperty(process, "platform", ...)` to simulate Linux