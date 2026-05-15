# Section 05: ClaudeClient

## Overview

This section implements the `ClaudeClient`, which spawns the local `claude` CLI binary as a subprocess, sends a prompt via stdin, captures stdout as JSON, and returns the response string. It enforces a configurable timeout with a SIGTERM-then-SIGKILL kill sequence.

**Dependencies:** Requires `section-01-foundation` to be complete (for `ClaudeTimeoutError` and `ClaudeExitError` from `src/errors.ts`).

**No dependency on sections 02, 03, or 04** — this section can be implemented in parallel with those.

---

## Files Created

- `02-integration-clients/src/claude/types.ts`
- `02-integration-clients/src/claude/ClaudeClient.ts`
- `02-integration-clients/tests/claude.test.ts`

The root `index.ts` was updated to re-export `ClaudeClient` and its types (there is no `src/index.ts`; the package root `index.ts` is the barrel file).

## Deviations from Plan

- **Constructor call shapes:** Spec showed `new ClaudeTimeoutError({ timeoutMs })` and `new ClaudeExitError({ exitCode, stderr })` (object bags). Actual `src/errors.ts` uses positional args. Implementation uses the correct positional form.
- **`timedOut` declaration:** Moved before `Bun.spawn` call (spec says "before spawning") rather than after stdin write.
- **`proc.exitCode` null check:** Changed `proc.exitCode !== 0` to `proc.exitCode !== null && proc.exitCode !== 0` to prevent null being cast to number via `!` assertion.
- **Runtime type guard on `parsed.result`:** Added `typeof result !== 'string'` check before return; spec omitted this guard.
- **`BunSubprocess.kill` signal type:** Narrowed from `string` to `NodeJS.Signals` for compile-time signal validation.

## Final Test Count

18 tests in `tests/claude.test.ts`, all passing. 99 total tests passing across the package.

---

## Tests First

File: `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/02-integration-clients/tests/claude.test.ts`

Mock `Bun.spawn` with a controllable test double. The test double must expose `stdin.write`, `stdin.end`, `stdout`, `stderr`, `exited`, `exitCode`, and `kill` as mockable surfaces.

### Test Cases to Implement

**Subprocess invocation:**

- Prompt is written to `proc.stdin` and the stdin is closed — the prompt string must NOT appear anywhere in the spawned CLI argument list (no `-p` flag, no positional arg containing the prompt).
- The env object passed to `Bun.spawn` must have `typeof env.CLAUDECODE === 'undefined'` — it must be fully deleted, not set to `undefined` (Bun converts `undefined` to the literal string `"undefined"` in the child env).
- The args array must contain `'--print'`, `'--bare'`, `'--no-session-persistence'`, `'--output-format'`, and `'json'`.
- When no `model` is configured, `'--model'` must not appear in the args.
- When `model` is configured (either via `ClaudeConfig.model` or `AskOptions.model`), `'--model'` and the model string must appear in the args.

**Happy path:**

- Exit code 0 with valid JSON stdout `{ "result": "some response" }` → `ask()` returns `"some response"`.
- `parsed.result` must be the string returned — not the whole parsed object.

**Error paths:**

- Non-zero exit code when `timedOut` is false → throws `ClaudeExitError` with the correct `exitCode` and `stderr` content.
- Exit code 0 but stdout is not valid JSON → throws a generic `Error` whose message contains the raw stdout string.

**Timeout behavior:**

- When the process does not exit within `timeoutMs`, SIGTERM is sent first.
- After a 2-second grace period, if `proc.exitCode` is still `null` (still alive), SIGKILL is sent.
- In this scenario, `ClaudeTimeoutError` is thrown (not `ClaudeExitError`), carrying the `timeoutMs` value.
- The `timedOut` flag must be checked before checking exit code, preventing the race condition where a kill causes a non-zero exit that would otherwise surface as `ClaudeExitError`.
- The timeout timer must be cleared in the `finally` block — verify there is no timer leak on a successful (exit 0) call.

**Stdout drain:**

- Both `proc.stdout` and `proc.stderr` must be read concurrently alongside `proc.exited`, using `Promise.all`. This prevents deadlocks when the subprocess produces output larger than the OS pipe buffer (~64 KB).

---

## Types

File: `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/02-integration-clients/src/claude/types.ts`

```typescript
/** Configuration for ClaudeClient. All instances of ClaudeClient take one of these. */
export interface ClaudeConfig {
  /** Absolute path to the claude CLI binary. */
  binaryPath: string
  /** Default timeout in milliseconds for subprocess calls. Default: 30000. */
  timeoutMs?: number
  /** Default model to pass via --model flag. Omit to use claude's own default. */
  model?: string
}

/** Per-call overrides for ClaudeClient.ask(). */
export interface AskOptions {
  /** Overrides ClaudeConfig.timeoutMs for this specific call. */
  timeoutMs?: number
  /** Overrides ClaudeConfig.model for this specific call. */
  model?: string
}
```

---

## Implementation

File: `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/02-integration-clients/src/claude/ClaudeClient.ts`

Import `ClaudeTimeoutError` and `ClaudeExitError` from `../errors`. Import `ClaudeConfig` and `AskOptions` from `./types`. Import the `Logger` type from `01-core-daemon` (or accept it as `any` / a structural interface if `01-core-daemon` is not yet available at the time of authoring this module).

### Class Signature

```typescript
export class ClaudeClient {
  constructor(config: ClaudeConfig, logger: Logger) { ... }
  async ask(prompt: string, options?: AskOptions): Promise<string> { ... }
}
```

### ask() Implementation Details

**Step 1 — Resolve effective options.**

The effective `timeoutMs` is `options?.timeoutMs ?? config.timeoutMs ?? 30000`. The effective `model` is `options?.model ?? config.model` (may be undefined).

**Step 2 — Build argument list.**

Start with the fixed flags:
```
[config.binaryPath, '--print', '--bare', '--no-session-persistence', '--output-format', 'json']
```
If `model` is set, append `['--model', model]` to the array.

**Step 3 — Prepare the environment.**

Clone `process.env` with `{ ...process.env }`. Then call `delete clonedEnv.CLAUDECODE`. Do NOT use `clonedEnv.CLAUDECODE = undefined` — Bun will serialize `undefined` as the string `"undefined"` when passing to the child process.

**Step 4 — Spawn the subprocess.**

```typescript
const proc = Bun.spawn(args, {
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
  env: clonedEnv,
})
```

**Step 5 — Write prompt to stdin and close it immediately.**

```typescript
proc.stdin.write(prompt)
proc.stdin.end()
```

This must happen before any `await`. Do not wait for the process to finish before closing stdin.

**Step 6 — Set up the timeout.**

Declare `let timedOut = false` before spawning. After spawning and writing stdin, set:

```typescript
const timer = setTimeout(async () => {
  timedOut = true
  proc.kill('SIGTERM')
  await Bun.sleep(2000)
  if (proc.exitCode === null) {
    proc.kill('SIGKILL')
  }
}, effectiveTimeoutMs)
```

**Step 7 — Drain stdout, stderr, and exited concurrently.**

```typescript
const [stdout, stderr] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
])
```

All three must run concurrently. Never `await proc.exited` before reading the pipes.

**Step 8 — Clear the timer in finally.**

Wrap the drain and post-processing in a `try/finally`:

```typescript
try {
  // drain + parse
} finally {
  clearTimeout(timer)
}
```

**Step 9 — Log completion.**

```typescript
logger.info({ event: 'claude_done', exitCode: proc.exitCode, durationMs })
```

Never log prompt content.

**Step 10 — Check timedOut before exit code.**

```typescript
if (timedOut) {
  throw new ClaudeTimeoutError({ timeoutMs: effectiveTimeoutMs })
}
if (proc.exitCode !== 0) {
  throw new ClaudeExitError({ exitCode: proc.exitCode, stderr })
}
```

The `timedOut` check must come first. If a kill causes a non-zero exit and `timedOut` is true, the caller receives `ClaudeTimeoutError`, not `ClaudeExitError`.

**Step 11 — Parse JSON and return.**

```typescript
let parsed: unknown
try {
  parsed = JSON.parse(stdout)
} catch {
  throw new Error(`ClaudeClient: malformed JSON output: ${stdout}`)
}
return (parsed as { result: string }).result
```

### Logging

Log subprocess start before spawning:
```typescript
logger.info({ event: 'claude_spawn', model: effectiveModel })
```

Log completion after drain:
```typescript
logger.info({ event: 'claude_done', exitCode: proc.exitCode, durationMs })
```

Never log the prompt string.

---

## Error Classes Used (from section-01-foundation)

Both errors are defined in `src/errors.ts` (created in section-01-foundation). Their expected shapes:

```typescript
class ClaudeTimeoutError extends Error {
  readonly type = 'CLAUDE_TIMEOUT' as const
  timeoutMs: number
}

class ClaudeExitError extends Error {
  readonly type = 'CLAUDE_EXIT' as const
  exitCode: number
  stderr: string
}
```

These are imported — do not redefine them in this section.

---

## Index Re-export Update

File: `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/02-integration-clients/src/index.ts`

Add the following exports (alongside whatever section-01-foundation already placed there):

```typescript
export { ClaudeClient } from './claude/ClaudeClient'
export type { ClaudeConfig, AskOptions } from './claude/types'
```

---

## Key Constraints and Edge Cases

- **Prompt via stdin, never argv.** Passing the prompt as a CLI argument exposes it in `ps aux` output and risks `ARG_MAX` limits on large prompts containing Jira issue bodies. Always use `proc.stdin.write(prompt)` followed by `proc.stdin.end()`.
- **`delete clonedEnv.CLAUDECODE`, not `= undefined`.** Bun's `Bun.spawn` passes env values as strings to the child. Setting a key to `undefined` in JavaScript does not remove it from the object the way `delete` does — Bun will serialize it as the string `"undefined"`, which means `CLAUDECODE` remains set in the subprocess.
- **Concurrent drain is mandatory.** If `proc.exited` is awaited before reading `proc.stdout` and `proc.stderr`, and the subprocess writes more than the OS pipe buffer allows (~64 KB), the subprocess blocks waiting for a reader. The parent is waiting for the process to exit. This is a deadlock. Always use `Promise.all`.
- **`timedOut` flag must be set before `proc.kill`.** The flag is the sole discriminant between a timeout kill and a genuine non-zero exit. Set it to `true` immediately when the timer fires, before any async operations.
- **Timer must be cleared in `finally`.** Without this, a resolved `ask()` call leaves a live timer that fires later and attempts to kill a process that has already exited (or a new process in a different call if `proc` is reused).
- **`proc.exitCode === null` check before SIGKILL.** After SIGTERM + 2s sleep, the process may have already exited. Only send SIGKILL if `exitCode` is still `null`.