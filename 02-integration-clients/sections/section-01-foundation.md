Now I have all the context I need. Let me generate the section content for `section-01-foundation`.

# Section 01: Foundation

## Overview

This section covers the project scaffolding and the shared error module. It has no dependencies on other sections and must be completed first — all other sections depend on it.

**Scope:**
- `package.json` with runtime and dev dependencies
- `tsconfig.json`
- `vitest.config.ts`
- `src/errors.ts` — 9 typed error classes with `readonly type` discriminants
- `index.ts` — re-exports all clients, types, and errors (stub form; updated as later sections land)
- `tests/errors.test.ts` — error class unit tests

---

## File Structure to Create

```
02-integration-clients/
  src/
    errors.ts
  index.ts            (stub, updated by later sections)
  tests/
    errors.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
```

All paths below are absolute from the repo root:

- `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/02-integration-clients/package.json`
- `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/02-integration-clients/tsconfig.json`
- `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/02-integration-clients/vitest.config.ts`
- `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/02-integration-clients/src/errors.ts`
- `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/02-integration-clients/index.ts`
- `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/02-integration-clients/tests/errors.test.ts`

---

## Tests First

File: `tests/errors.test.ts`

Write these tests before implementing `src/errors.ts`. All tests are pure — no mocks, no network, no subprocesses.

### Test cases to implement

**`JiraAuthError`**
- Is `instanceof Error`
- Has `.type === 'JIRA_AUTH'`
- Carries a message (standard Error behavior)

**`JiraPermissionError`**
- Is `instanceof Error`
- Has `.type === 'JIRA_PERMISSION'`

**`JiraNotFoundError`**
- Is `instanceof Error`
- Has `.type === 'JIRA_NOT_FOUND'`
- Carries `.issueKey: string` (the issue key passed at construction time)

**`JiraRateLimitError`**
- Is `instanceof Error`
- Has `.type === 'JIRA_RATE_LIMIT'`
- Carries `.retryAfter?: number` — present when provided, absent when not

**`JiraServerError`**
- Is `instanceof Error`
- Has `.type === 'JIRA_SERVER'`
- Carries `.status: number` (the HTTP status code)

**`JiraTimeoutError`**
- Is `instanceof Error`
- Has `.type === 'JIRA_TIMEOUT'`

**`InvalidTransitionError`**
- Is `instanceof Error`
- Has `.type === 'INVALID_TRANSITION'`
- Carries `.attempted: string` (the transition name that was tried)
- Carries `.available: string[]` (the list of valid transition names)

**`ClaudeTimeoutError`**
- Is `instanceof Error`
- Has `.type === 'CLAUDE_TIMEOUT'`
- Carries `.timeoutMs: number`

**`ClaudeExitError`**
- Is `instanceof Error`
- Has `.type === 'CLAUDE_EXIT'`
- Carries `.exitCode: number`
- Carries `.stderr: string`

**Discriminant switch test**

All 9 error types are distinguishable by their `type` field. Write a test that puts all 9 instances in an array, switches on `.type`, and asserts each branch was reached exactly once. This confirms the discriminant union is exhaustive and all `type` values are unique strings.

### Test file stub

```typescript
// tests/errors.test.ts
import { describe, it, expect } from 'vitest'
import {
  JiraAuthError,
  JiraPermissionError,
  JiraNotFoundError,
  JiraRateLimitError,
  JiraServerError,
  JiraTimeoutError,
  InvalidTransitionError,
  ClaudeTimeoutError,
  ClaudeExitError,
} from '../src/errors'

describe('JiraAuthError', () => {
  it('is instanceof Error with correct type', () => { /* ... */ })
})

describe('JiraNotFoundError', () => {
  it('carries issueKey', () => { /* ... */ })
})

describe('JiraRateLimitError', () => {
  it('carries optional retryAfter', () => { /* ... */ })
})

describe('JiraServerError', () => {
  it('carries status code', () => { /* ... */ })
})

describe('InvalidTransitionError', () => {
  it('carries attempted and available[]', () => { /* ... */ })
})

describe('ClaudeTimeoutError', () => {
  it('carries timeoutMs', () => { /* ... */ })
})

describe('ClaudeExitError', () => {
  it('carries exitCode and stderr', () => { /* ... */ })
})

describe('type discriminant switch', () => {
  it('all 9 types are uniquely distinguishable', () => { /* ... */ })
})
```

---

## Implementation

### `package.json`

The project uses Bun as runtime. Vitest is the test runner. grammY is the only runtime dependency.

```json
{
  "name": "02-integration-clients",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "grammy": "^1.x"
  },
  "devDependencies": {
    "vitest": "^2.x",
    "typescript": "^5.x",
    "@types/node": "^20.x"
  }
}
```

Replace `^1.x`, `^2.x`, `^5.x`, `^20.x` with the actual latest semver versions at install time.

### `tsconfig.json`

Target ESNext with module resolution appropriate for Bun. Enable strict mode. Include `src/` and `tests/`.

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*", "index.ts"]
}
```

### `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
})
```

### `src/errors.ts`

Define all 9 typed error classes. Key rules:
- Every class extends `Error`
- Every class has a `readonly type` property set to a unique `as const` string literal
- Every class calls `super(message)` and sets `this.name` to the class name
- Extra payload fields are set in the constructor

Signature stubs (implement fully — these are small enough that full implementation is appropriate):

```typescript
// src/errors.ts

export class JiraAuthError extends Error {
  readonly type = 'JIRA_AUTH' as const
  constructor(message = 'Jira authentication failed') {
    super(message)
    this.name = 'JiraAuthError'
  }
}

export class JiraPermissionError extends Error {
  readonly type = 'JIRA_PERMISSION' as const
  // ...
}

export class JiraNotFoundError extends Error {
  readonly type = 'JIRA_NOT_FOUND' as const
  readonly issueKey: string
  constructor(issueKey: string, message?: string) {
    super(message ?? `Issue ${issueKey} not found`)
    this.name = 'JiraNotFoundError'
    this.issueKey = issueKey
  }
}

export class JiraRateLimitError extends Error {
  readonly type = 'JIRA_RATE_LIMIT' as const
  readonly retryAfter?: number
  constructor(retryAfter?: number, message?: string) { /* ... */ }
}

export class JiraServerError extends Error {
  readonly type = 'JIRA_SERVER' as const
  readonly status: number
  constructor(status: number, message?: string) { /* ... */ }
}

export class JiraTimeoutError extends Error {
  readonly type = 'JIRA_TIMEOUT' as const
  constructor(message = 'Jira request timed out') { /* ... */ }
}

export class InvalidTransitionError extends Error {
  readonly type = 'INVALID_TRANSITION' as const
  readonly attempted: string
  readonly available: string[]
  constructor(attempted: string, available: string[], message?: string) { /* ... */ }
}

export class ClaudeTimeoutError extends Error {
  readonly type = 'CLAUDE_TIMEOUT' as const
  readonly timeoutMs: number
  constructor(timeoutMs: number, message?: string) { /* ... */ }
}

export class ClaudeExitError extends Error {
  readonly type = 'CLAUDE_EXIT' as const
  readonly exitCode: number
  readonly stderr: string
  constructor(exitCode: number, stderr: string, message?: string) { /* ... */ }
}
```

### `index.ts` (stub)

Create a stub that re-exports only what exists after this section. Later sections will add their own export lines.

```typescript
// index.ts
// Re-exports updated by each section as it is implemented.

export * from './src/errors'

// TODO (section-03): export * from './src/telegram/TelegramClient'
// TODO (section-03): export * from './src/telegram/types'
// TODO (section-04): export * from './src/jira/JiraClient'
// TODO (section-04): export * from './src/jira/types'
// TODO (section-05): export * from './src/claude/ClaudeClient'
// TODO (section-05): export * from './src/claude/types'
```

---

## Implementation Notes

**Error class prototype chain**: In TypeScript targeting ES5, `instanceof` checks on subclassed `Error` can break unless `Object.setPrototypeOf(this, new.target.prototype)` is called in the constructor after `super()`. If targeting ESNext (as in this project), this is not needed. If tests show unexpected `instanceof` failures, add it.

**`readonly type` discriminant**: The `as const` assertion on the `type` property literal is what makes TypeScript narrow the union correctly in a `switch(err.type)` statement. Without `as const`, the type widens to `string` and narrowing is lost.

**`this.name`**: Setting `this.name = 'JiraAuthError'` (etc.) ensures `.toString()` and stack traces show the class name rather than `"Error"`. This also helps when errors are serialised to logs.

**No circular dependencies**: `src/errors.ts` imports nothing from this project. It is safe to import from any other file in the module.

---

## Acceptance Criteria

This section is complete when:

1. `package.json`, `tsconfig.json`, and `vitest.config.ts` exist and are valid.
2. `src/errors.ts` exports all 9 error classes.
3. `tests/errors.test.ts` passes with `vitest run` — all `instanceof`, `.type`, and payload field assertions green.
4. The discriminant switch test covers all 9 types with zero uncovered branches.
5. `index.ts` exists and re-exports from `src/errors.ts` without TypeScript errors (`tsc --noEmit` passes).
6. No other section's files are required for `vitest run` to complete successfully at this point.

## Implementation Notes (Actual)

**Status: COMPLETE — 12/12 tests passing**

### Deviations from Plan

- `package.json` got `"typecheck": "tsc --noEmit"` script and `"exports": { ".": "./index.ts" }` field (review finding #4, #6)
- `vitest.config.ts` got `include: ['tests/**/*.test.ts']` to pin test discovery (review finding #5)
- Discriminant switch test got exhaustiveness `default: never` branch + array length assertion (review finding #2)
- `JiraPermissionError` test asserts `.message`; `JiraTimeoutError` test asserts `.name` (review finding #7, #8)
- `Object.setPrototypeOf` intentionally omitted — ESNext target, user confirmed

### Files Created

- `02-integration-clients/src/errors.ts` — 9 typed error classes
- `02-integration-clients/index.ts` — stub re-export
- `02-integration-clients/tests/errors.test.ts` — 12 tests
- `02-integration-clients/package.json`
- `02-integration-clients/tsconfig.json`
- `02-integration-clients/vitest.config.ts`
- `02-integration-clients/bun.lock` — generated by `bun install`

### Test Count: 12 tests across 9 error class describe blocks + 1 discriminant switch block

---

## Dependencies

This section has no dependencies on other sections.

The following sections depend on this section being complete before they can start:
- `section-02-adf-helpers` (imports nothing from errors directly, but requires the project to be set up)
- `section-03-telegram` (imports `ClaudeTimeoutError`, `ClaudeExitError`, `JiraAuthError`, `JiraNotFoundError`, `InvalidTransitionError` from `src/errors.ts`)
- `section-04-jira` (imports all Jira error classes and `InvalidTransitionError` from `src/errors.ts`)
- `section-05-claude` (imports `ClaudeTimeoutError`, `ClaudeExitError` from `src/errors.ts`)