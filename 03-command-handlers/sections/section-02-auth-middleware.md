Now I have all the context needed. Let me generate the section content for `section-02-auth-middleware`.

# Section 02: Authorization Middleware

## Overview

This section implements the authorization middleware that guards every incoming Telegram update. It must be completed after `section-01-foundation` and before `section-07-registration-and-bot`. It can be developed in parallel with `section-03-utils` and handler sections.

**Depends on:** `section-01-foundation` (project scaffold, `Config` type, `loadConfig`)
**Blocks:** `section-07-registration-and-bot`

---

## Files Created (Actual — root layout)

- `src/bot/middleware/auth.ts` — middleware factory function
- `tests/bot/middleware/auth.test.ts` — 8 bun:test cases (6 from plan + 2 added in review)

Note: All paths use `src/bot/` prefix (not `src/`). Uses bun:test + mock() not vitest/grammytest.

---

## Tests First

Write `tests/middleware/auth.test.ts` before implementing. The test harness uses `@grammyjs/grammytest` for in-memory bot simulation and `vi.fn()` for the logger mock. All tests run against real grammY middleware pipeline without any HTTP calls.

### Test Cases

**File:** `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/03-command-handlers/tests/middleware/auth.test.ts`

1. **Authorized user — `next()` is called**
   - Construct a `Set<number>` containing a known ID (e.g., `12345`)
   - Fire an in-memory update from a user with that ID
   - Assert that `next()` was called (middleware did not block)

2. **Unauthorized user — `next()` is NOT called, no reply sent**
   - Construct a `Set<number>` that does NOT contain the user's ID
   - Fire an in-memory update
   - Assert `next()` was NOT called
   - Assert no reply was sent to the chat

3. **`ctx.from` is `undefined` — treated as unauthorized**
   - Simulate an update where `ctx.from` is absent (e.g., a channel post with no sender)
   - Assert `next()` was NOT called
   - Assert no crash (no thrown error)

4. **Empty `Set` — all users unauthorized**
   - Pass an empty `Set<number>()` to `createAuthMiddleware`
   - Fire any update
   - Assert `next()` was NOT called

5. **Unauthorized attempt — logger receives correct payload**
   - Inject a `vi.fn()` logger into the middleware
   - Fire an update from an unauthorized user in a known `chatId`
   - Assert logger was called with exactly `{ event: 'unauthorized', chatId }` — the userId must NOT appear in the logged object

6. **Authorized attempt — logger does NOT log unauthorized event**
   - Inject the same `vi.fn()` logger
   - Fire an update from an authorized user
   - Assert the logger was NOT called with any object containing `event: 'unauthorized'`

---

## Implementation

### File: `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/03-command-handlers/src/middleware/auth.ts`

The module exports a single factory function. The allowlist is received as a `Set<number>` — it is loaded once at startup by `loadConfig()` and passed in; no dynamic reloading logic belongs here.

**Function signature:**

```typescript
import type { Context, MiddlewareFn } from 'grammy'

/**
 * Creates a grammY middleware that silently drops updates from users not in
 * the allowlist. Never replies to unauthorized users — silence is intentional
 * to avoid confirming the bot's existence.
 *
 * Known limitation: Telegram's command menu (populated via setCommands()) is
 * visible to all users who can discover the bot, including unauthorized ones.
 * They will see /create, /solve, etc. in the UI, attempt them, and receive
 * silence. This is acceptable for a personal/small-team bot. Scoping the menu
 * per-user would require individual setCommands() calls per chat_id.
 *
 * @param allowedIds - Pre-loaded Set<number> of permitted Telegram user IDs.
 *   O(1) lookup. Populated from ALLOWED_USER_IDS at startup.
 * @param logger - Optional injectable logger function. Defaults to console.log.
 *   Receives plain objects only; never receives userId (PII).
 */
export function createAuthMiddleware(
  allowedIds: Set<number>,
  logger?: (entry: Record<string, unknown>) => void
): MiddlewareFn<Context>
```

**Behavior spec:**

- Extract `ctx.from?.id` — if `undefined`, treat as unauthorized
- Check the ID against `allowedIds` using `Set.has()` — O(1)
- If unauthorized:
  - Call `logger({ event: 'unauthorized', chatId: ctx.chat?.id })` — `chatId` only, never `userId`
  - `return` immediately — do NOT call `next()`, do NOT call `ctx.reply()`
- If authorized:
  - `return next()`

The logger parameter should default to `(entry) => console.log(entry)` if not provided, making the logger injectable for tests without requiring a full DI framework.

**Implementation stub:**

```typescript
export function createAuthMiddleware(
  allowedIds: Set<number>,
  logger: (entry: Record<string, unknown>) => void = (e) => console.log(e)
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    // Extract user ID — undefined if update has no sender (e.g., channel posts)
    const userId = ctx.from?.id

    if (userId === undefined || !allowedIds.has(userId)) {
      // Log chatId only — never userId (PII)
      logger({ event: 'unauthorized', chatId: ctx.chat?.id })
      return  // silent drop — no reply
    }

    return next()
  }
}
```

---

## Key Design Decisions

**Silent drop, no reply:** Unauthorized users receive no acknowledgment. Replying (even with "Unauthorized") leaks the bot's existence and could attract further probing. Silence is the correct behavior for a personal bot.

**PII logging rule:** Log `chatId`, never `userId`. This is a project-wide convention. The `chatId` identifies the conversation context for debugging; the `userId` is personal identifying information and must not appear in logs.

**No dynamic allowlist reloading:** The `Set<number>` is constructed once by `loadConfig()` at process startup. If the allowlist needs to change, the process restarts. This simplifies the middleware to a pure lookup with no file-watch or IPC complexity.

**`ctx.from` undefined handling:** grammY's `Context` types `ctx.from` as optional. Channel posts, for example, have no sender. The middleware must not crash on undefined — it treats missing sender as unauthorized, which is the safe default.

**Logger injection pattern:** The logger is an optional parameter with a `console.log` default. This avoids a global logger singleton and makes unit testing straightforward — tests pass a `vi.fn()` to assert on logged payloads without mocking module globals.

**`bot.catch` compatibility:** Because the auth middleware only `return`s and never `throw`s, grammY's global `bot.catch` handler will only fire for errors in authorized execution paths. The auth drop path is intentionally error-free.

---

## Integration Note (for `section-07-registration-and-bot`)

The middleware is applied in `src/bot.ts` as the first item in the middleware stack, before any command handlers or the throttler:

```typescript
// In bot.ts — applied before all other middleware
bot.use(createAuthMiddleware(config.allowedUserIds))
```

The `config.allowedUserIds` field is a `Set<number>` produced by `loadConfig()` from `section-01-foundation`. The middleware must be installed before `bot.use(myCommands)` so that unauthorized updates are dropped before reaching any command handler.