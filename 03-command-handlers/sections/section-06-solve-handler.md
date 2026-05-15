Now I have all the context needed. Let me generate the section content for `section-06-solve-handler`.

# Section 06: Handler — /solve

## Overview

This section implements the `/solve` command handler, which is the most complex handler in the module. It fetches a Jira issue, builds a prompt using XML-delimited fields for injection safety, calls Claude, and delivers the response — potentially split across multiple messages.

**File created:** `src/bot/commands/solve.ts` (plan path was `03-command-handlers/src/commands/solve.ts` — all code lives at root `src/bot/commands/`, established by section-01)
**Test file created:** `tests/bot/commands/solve.test.ts`

## Implementation Notes

- Tests use `bun:test` with `mock()` (not vitest/grammytest as plan spec suggests — bun:test is the project convention)
- `ctx.replyWithChatAction("typing")` used (not `ctx.sendChatAction` from plan — grammY convention from existing create.ts)
- Interval setup uses `let typingInterval | undefined` pattern with `finally` guard to prevent leaks if replyWithChatAction rejects
- `issue.description ?? ""` added for null safety (Jira issues may have no description)
- 16 tests, 0 failures. Full suite: 272 pass.

**Dependencies (must be completed before this section):**
- `section-01-foundation` — project setup, `Config` type, `tsconfig.json`, `vitest.config.ts`
- `section-03-utils` — `parseArgs` from `src/utils/parseArgs.ts` and `splitMessage` from `src/utils/splitMessage.ts`

**Blocks:** `section-07-registration-and-bot`

---

## Tests First

Create `03-command-handlers/tests/commands/solve.test.ts` with the following test stubs. All tests use `@grammyjs/grammytest` for in-memory bot dispatch and `vi.fn()` mocks for `JiraClient` and `ClaudeClient`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
// import grammytest harness, handleSolve, SOLVE_PROMPT_TEMPLATE, mock clients

describe('handleSolve', () => {
  // Setup: create mock JiraClient and ClaudeClient with vi.fn()
  // Setup: create grammytest bot instance with handleSolve wired to /solve

  it('sends intermediate "Analyzing…" reply before calling getIssue', async () => {
    // Simulate /solve ENG-1
    // Assert first reply contains "Analyzing" and "ENG-1"
    // Assert getIssue was called with "ENG-1"
  })

  it('calls ClaudeClient.ask after fetching the issue', async () => {
    // Mock getIssue to return { key: "ENG-1", summary: "...", status: "...", description: "..." }
    // Simulate /solve ENG-1
    // Assert ClaudeClient.ask was called once
    // Assert the final reply contains Claude's response text
  })

  it('sends a single reply when Claude response is ≤ 4096 chars', async () => {
    // Mock ClaudeClient.ask to return a string of 100 chars
    // Simulate /solve ENG-1
    // Assert ctx.reply was called exactly twice (intermediate + final), no [N/M] prefix on final
  })

  it('sends multiple replies prefixed [N/M] when Claude response is > 4096 chars', async () => {
    // Mock ClaudeClient.ask to return a string > 4096 chars
    // Simulate /solve ENG-1
    // Assert ctx.reply called more than twice
    // Assert each content reply is prefixed [1/N], [2/N], etc.
  })

  it('replies with error and does NOT call ClaudeClient when JiraNotFoundError is thrown', async () => {
    // Mock getIssue to throw JiraNotFoundError
    // Simulate /solve ENG-1
    // Assert ClaudeClient.ask was NOT called
    // Assert reply contains "ENG-1" and communicates not found
  })

  it('replies with "timed out" message when ClaudeTimeoutError is thrown', async () => {
    // Mock ClaudeClient.ask to throw ClaudeTimeoutError
    // Simulate /solve ENG-1
    // Assert reply contains "timed out"
  })

  it('replies with error message when ClaudeExitError is thrown', async () => {
    // Mock ClaudeClient.ask to throw ClaudeExitError
    // Simulate /solve ENG-1
    // Assert reply contains "error"
  })

  it('replies with usage string when no args are provided', async () => {
    // Simulate /solve (no arguments)
    // Assert usage string is sent
    // Assert getIssue and ClaudeClient.ask are NOT called
  })

  it('handles Jira description of 10,000+ chars without crashing', async () => {
    // Mock getIssue to return an issue with description of 12,000 chars
    // Simulate /solve ENG-1
    // Assert ClaudeClient.ask was called with a prompt containing the full description
    // Assert no error was thrown during prompt construction
  })
})

describe('SOLVE_PROMPT_TEMPLATE', () => {
  it('contains <description> XML delimiter', () => {
    // Assert SOLVE_PROMPT_TEMPLATE includes "<description>"
  })

  it('contains <title> XML delimiter', () => {
    // Assert SOLVE_PROMPT_TEMPLATE includes "<title>"
  })

  it('contains <key> XML delimiter', () => {
    // Assert SOLVE_PROMPT_TEMPLATE includes "<key>"
  })

  it('contains <status> XML delimiter', () => {
    // Assert SOLVE_PROMPT_TEMPLATE includes "<status>"
  })
})
```

---

## Implementation

### File: `03-command-handlers/src/commands/solve.ts`

#### Exported constants

Define and export `SOLVE_PROMPT_TEMPLATE` as a string constant at the top of the file. The template must:
- Use `<key>...</key>` to delimit the Jira ticket key
- Use `<title>...</title>` to delimit the issue summary
- Use `<status>...</status>` to delimit the issue status
- Use `<description>...</description>` to delimit the issue description

These XML-style delimiters signal to Claude that the enclosed content is data, not instructions — this is the prompt injection defense. The template should instruct Claude to analyze the issue and provide actionable next steps or a solution approach.

Do NOT inline the template string inside the handler function — it must be an exported constant so tests can assert on its structure independently.

#### Exported function stub

```typescript
export const SOLVE_PROMPT_TEMPLATE: string  // XML-delimited fields: <key>, <title>, <status>, <description>

async function handleSolve(ctx: Context, clients: Clients): Promise<void>
```

`handleSolve` is the default export (or named export used by `commands/index.ts`). The `Clients` interface is defined in `src/commands/index.ts` (section 07) but can be forward-declared here for local typing until that section is complete.

#### Step-by-step implementation logic

1. **Parse ticket key**: Use `parseArgs(ctx)` from `src/utils/parseArgs.ts`. Take `args[0]` as the key. If `args` is empty or `args[0]` is falsy, call `ctx.reply(<usage string>)` and `return` immediately. Do NOT call getIssue or Claude.

2. **Intermediate reply**: Call `await ctx.reply(\`Analyzing ${key} with Claude...\`)` before any API call. This gives the user immediate feedback since the combined Jira + Claude round-trip may take 10–30 seconds.

3. **Start typing refresh**: Call `ctx.sendChatAction("typing")`, then start a `setInterval` that calls `ctx.sendChatAction("typing")` every 4000 ms. Store the interval handle. The typing indicator only lasts ~5 seconds; without refresh it vanishes before Claude responds. The interval must be cleared in a `finally` block.

4. **Fetch issue**: Call `await clients.jira.getIssue(key)` to obtain `{ key, summary, status, description }`. If this throws `JiraNotFoundError`, catch it, clear the interval (or rely on `finally`), and reply with an appropriate error message referencing the key. Return without calling Claude. Any `JiraAuthError` or other Jira error should also be caught and replied to per the error matrix.

5. **Build prompt**: Substitute the issue fields into `SOLVE_PROMPT_TEMPLATE` using `.replace()` calls. Each field is wrapped in its XML delimiter. Example:
   ```
   prompt = SOLVE_PROMPT_TEMPLATE
     .replace('<key>', issue.key).replace('</key>', '')   // or use placeholder tokens
     .replace(...)
   ```
   The exact substitution mechanism is up to the implementer — a simple approach is to use placeholder tokens in the template such as `{{KEY}}`, `{{TITLE}}`, etc., and `.replace()` each. The important constraint is that untrusted content (from Jira) is placed inside the XML tags, not concatenated raw into the prompt.

6. **Call Claude**: Call `await clients.claude.ask(prompt)`. No retry logic — fail immediately on error. This is the only async call that should be wrapped with the typing interval active.

7. **Clear interval** (`finally` block): Always clear the interval here regardless of success or failure.

8. **Split and send**: Pass the Claude response through `splitMessage(response)` from `src/utils/splitMessage.ts`. Iterate the resulting array and call `await ctx.reply(chunk)` for each chunk sequentially. The throttler (installed in `bot.ts` in section 07) handles rate limiting automatically — the handler does not need to implement any delay logic.

9. **Error handling**: The entire handler body (excluding the intermediate reply) should be wrapped in `try/catch`. For typed error classes from `02-integration-clients`:
   - `JiraNotFoundError` → reply mentioning the key is not found
   - `JiraAuthError` → reply mentioning authentication/token issue
   - `ClaudeTimeoutError` → reply containing "timed out"
   - `ClaudeExitError` → reply containing "error"
   - Unknown errors → log `{ event: 'error', command: 'solve', errorMessage: error.message }` (never log the full error object, never log the raw prompt or Jira description content), reply with a generic error message

#### Known limitations to document in code comments

- **At-least-once delivery risk**: If the process crashes after step 2 (the intermediate reply) but before step 4 completes, Telegram re-delivers the update on restart. The user may trigger the same `/solve` twice. No deduplication is implemented — this is an accepted risk for a personal bot.
- **Sequential delivery latency**: With the throttler's 1 msg/s limit, a 10-chunk response takes ~10 seconds. Expected behavior for a personal bot.

---

## Error Matrix for /solve

| Error type | User-facing reply |
|---|---|
| No args | `Usage: /solve <ticket-key>` (or similar usage string) |
| `JiraNotFoundError` | `Ticket ENG-123 not found.` (include the key) |
| `JiraAuthError` | `Jira authentication failed. Check your API token.` |
| `ClaudeTimeoutError` | `Claude timed out. Please try again.` |
| `ClaudeExitError` | `Claude returned an error. Please try again.` |
| Unknown error | `Something went wrong. Please try again.` |

---

## Integration Client Types Referenced

The handler calls these methods from `02-integration-clients` (already built; do not re-implement):

- `JiraClient.getIssue(key: string): Promise<{ key: string; summary: string; status: string; description: string }>`
- `ClaudeClient.ask(prompt: string): Promise<string>`

Error classes thrown by those clients (import from `02-integration-clients` or re-export from a shared types location established in section 01):
- `JiraNotFoundError`
- `JiraAuthError`
- `ClaudeTimeoutError`
- `ClaudeExitError`
- `InvalidTransitionError` (not relevant here, but defined in the same module)

---

## Utilities Used

Both utilities are implemented in `section-03-utils`:

- `parseArgs(ctx: Context): string[]` — from `src/utils/parseArgs.ts`. Returns the space-split tokens of `ctx.match`. Use `args[0]` for the ticket key.
- `splitMessage(text: string, limit?: number): string[]` — from `src/utils/splitMessage.ts`. Splits at paragraph boundaries with word-boundary fallback; prefixes all chunks `[N/M]` when there is more than one chunk; reserves 8 characters for the longest prefix.