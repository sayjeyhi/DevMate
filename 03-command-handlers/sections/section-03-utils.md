Now I have all the necessary context. I'll generate the section content for `section-03-utils`.

# Section 03: Utilities — Argument Parsing and Message Splitting

## Overview

This section implements two pure utility modules with no external dependencies. They are foundational to sections 04, 05, and 06 (all command handlers depend on these). Both utilities are pure functions with no side effects and no dependency on grammY context beyond what is passed in.

**Dependency:** Requires `section-01-foundation` to be complete (TypeScript project scaffold, `tsconfig.json`, `package.json`, Vitest config in place).

**Blocks:** `section-04-create-handler`, `section-05-move-comment-help-handlers`, `section-06-solve-handler`.

---

## Files Created (Actual — root layout)

```
src/bot/utils/
  parseArgs.ts      ← parseArgs(ctx) + parseFirstAndRest(input)
  splitMessage.ts   ← [N/M]-prefixed splitter (distinct from src/telegram/splitMessage.ts)
tests/bot/utils/
  parseArgs.test.ts ← 5 bun:test cases
  splitMessage.test.ts ← 9 bun:test cases
```

Uses bun:test. No vitest/grammytest.

---

## Tests First

Write tests before implementation. Both test files use Vitest (`vitest run`). No mocking required — these are pure functions.

### `tests/utils/parseArgs.test.ts`

Tests for `parseArgs` (grammY context split):

- Empty match string `""` → returns `[]`
- Single token `"ENG-1"` → returns `["ENG-1"]`
- Multiple tokens `"ENG-1 In Progress"` → returns `["ENG-1", "In", "Progress"]`
- Extra surrounding whitespace `"  ENG-1   In  Progress  "` → returns `["ENG-1", "In", "Progress"]` (trimmed and empty strings filtered)

Tests for `parseFirstAndRest` (regex-based key + remainder):

- `"ENG-1 Hello   world"` → `{ first: "ENG-1", rest: "Hello   world" }` — note that multiple spaces inside the remainder are preserved exactly
- `"ENG-1"` (single token, no remainder) → `null`
- `""` (empty string) → `null`
- `"ENG-1 "` (trailing space after first token, empty remainder) — document the expected behavior in the test: the regex `/^(\S+)\s+([\s\S]*)$/` requires at least one `\s` between groups and any remainder (including empty string `""`). Decide and commit to either `null` or `{ first: "ENG-1", rest: "" }` and make the test explicit about it.

```typescript
// tests/utils/parseArgs.test.ts
import { describe, it, expect, vi } from 'vitest'
import { parseArgs, parseFirstAndRest } from '../../src/utils/parseArgs'
import type { Context } from 'grammy'

describe('parseArgs', () => {
  /** Returns empty array when ctx.match is empty */
  it('empty match → []', () => { ... })
  /** Single token */
  it('single token', () => { ... })
  /** Multiple tokens split on whitespace */
  it('multiple tokens', () => { ... })
  /** Trims and filters empty strings from extra whitespace */
  it('extra whitespace trimmed and filtered', () => { ... })
})

describe('parseFirstAndRest', () => {
  /** Preserves internal spacing in remainder */
  it('preserves multiple spaces in rest', () => { ... })
  /** Single token returns null */
  it('single token → null', () => { ... })
  /** Empty string returns null */
  it('empty → null', () => { ... })
  /** Document behavior for trailing space */
  it('trailing space behavior is defined', () => { ... })
})
```

### `tests/utils/splitMessage.test.ts`

Test all edge cases for the 4096-character splitter:

- Text ≤ 4096 chars (e.g., 100 chars) → single-element array, no `[N/M]` prefix
- Text exactly 4096 chars → single-element array, no prefix
- Text 4097 chars → two chunks, both prefixed: `[1/2]` and `[2/2]`
- Text with `\n\n` boundaries → splits at paragraph boundaries, not mid-word; `\n\n` is preserved when rejoining paragraphs within a single chunk
- Single paragraph longer than limit (no `\n\n`, but with spaces) → splits at last space before the effective limit
- Single word longer than limit (no spaces, no `\n\n`) → hard character cut (must not infinite loop)
- 10-part split → all chunks prefixed `[1/10]` through `[10/10]`
- Prefix reservation: no prefixed chunk exceeds 4096 chars. The effective limit when prefixes are applied is `4096 - 8` = 4088 chars (reserving 8 chars for `[99/99] `)
- `splitMessage("", 4096)` → returns `[""]` or `[]` — document the chosen behavior in the test

```typescript
// tests/utils/splitMessage.test.ts
import { describe, it, expect } from 'vitest'
import { splitMessage } from '../../src/utils/splitMessage'

const LIMIT = 4096

describe('splitMessage', () => {
  /** Short text — no split, no prefix */
  it('short text returned as single element', () => { ... })
  /** Exact limit — no split */
  it('text at exact limit returned as single element', () => { ... })
  /** One char over limit — two prefixed chunks */
  it('text over limit → two prefixed chunks', () => { ... })
  /** Paragraph-boundary splitting */
  it('splits at \\n\\n boundaries', () => { ... })
  /** Word-boundary fallback within a long paragraph */
  it('splits at last space when no paragraph boundary available', () => { ... })
  /** Hard cut for single long word with no spaces */
  it('hard cuts a word with no spaces (no infinite loop)', () => { ... })
  /** Multi-part prefixing */
  it('10-part split has correct [N/10] prefixes', () => { ... })
  /** Prefix does not push chunks over the limit */
  it('prefixed chunks never exceed LIMIT characters', () => { ... })
  /** Empty string behavior is defined */
  it('empty string returns defined value', () => { ... })
})
```

---

## Implementation

### `src/utils/parseArgs.ts`

Two exported functions.

**`parseArgs(ctx: Context): string[]`**

Reads `ctx.match` (the string following the command in the message), trims it, splits on any whitespace, and filters out empty strings. Used when all tokens are independent and positional (e.g., `/solve ENG-1`).

```typescript
/**
 * Extracts positional arguments from ctx.match.
 * Trims the match string, splits on whitespace, and filters empty strings.
 * Returns [] if match is empty or undefined.
 */
export function parseArgs(ctx: Context): string[]
```

**`parseFirstAndRest(input: string): { first: string; rest: string } | null`**

Uses the regex `/^(\S+)\s+([\s\S]*)$/` to split the first whitespace-delimited token from the raw unsplit remainder. Returns `null` if the input does not contain a whitespace separator (i.e., there is no remainder). The remainder is captured verbatim — spaces, tabs, and any other whitespace within the remainder are preserved. This is important for `/comment` (comment body formatting) and `/move` (status names like `"In Progress"`).

```typescript
/**
 * Splits input into the first whitespace-delimited token and the raw remainder.
 * Uses regex /^(\S+)\s+([\s\S]*)$/ — preserves all whitespace within the remainder.
 * Returns null if input has only one token or is empty.
 */
export function parseFirstAndRest(input: string): { first: string; rest: string } | null
```

Note on `ctx.match`: In grammY, when a command handler is registered with a `CommandGroup`, `ctx.match` is the string after the command trigger, e.g., for `/move ENG-1 In Progress` the match is `"ENG-1 In Progress"`. `parseArgs` accepts `Context` and reads `ctx.match` directly. `parseFirstAndRest` accepts a raw string so it can be called with `(ctx.match as string)` by the handler after a null check.

---

### `src/utils/splitMessage.ts`

One exported function.

**`splitMessage(text: string, limit?: number): string[]`**

Default limit is `4096` (Telegram's message character limit).

Algorithm (in order):

1. If `text.length <= limit`, return `[text]` immediately.
2. Split `text` into paragraphs on `\n\n` double-newline boundaries.
3. Accumulate paragraphs into a chunk by rejoining with `\n\n`. Continue adding paragraphs until the next paragraph would push the current chunk over the effective limit. When that happens, save the current chunk and start a new one.
4. Effective limit: when constructing chunks, the algorithm must reserve space for the longest possible prefix. For up to 99 parts, the prefix `[99/99] ` is 8 characters. The effective limit for chunk content is `limit - 8`. Apply this reservation unconditionally during chunk accumulation (even before the final part count is known) to ensure no chunk content overflows when prefixes are applied later.
5. If a single paragraph exceeds the effective limit (step 4 cannot fit it in one chunk), fall through to word-boundary splitting: scan from position `effectiveLimit` backward to find the last space character, and split there.
6. Last resort (no space found): hard-cut at `effectiveLimit` characters.
7. After all chunks are assembled, if there is more than one chunk, prepend `[N/M] ` to each chunk where `M` is the total count.

```typescript
/**
 * Splits text into chunks that fit within `limit` characters (default 4096).
 * Splits preferentially at \n\n paragraph boundaries, then at word boundaries,
 * then hard-cuts as a last resort.
 * When more than one chunk is produced, each chunk is prefixed [N/M].
 * Reserves 8 characters per chunk for the prefix to ensure prefixed chunks
 * never exceed `limit`.
 */
export function splitMessage(text: string, limit?: number): string[]
```

Key behavioral constraints to enforce in implementation and tests:

- `\n\n` is preserved when paragraphs are rejoined within a single chunk (do not strip double-newlines from output)
- Part numbering uses 1-based indexing: `[1/M]`, `[2/M]`, ..., `[M/M]`
- The prefix format is `[N/M] ` (with a trailing space before the content)
- A single-part result has NO prefix
- The function must not enter an infinite loop on any input (the hard-cut case prevents this)

---

## Usage by Downstream Sections

- **section-04-create-handler** (`src/commands/create.ts`): uses `parseArgs` to extract the full input, then applies its own `--` separator logic on the result.
- **section-05-move-comment-help-handlers**:
  - `move.ts`: uses `parseFirstAndRest` to split ticket key from raw status string
  - `comment.ts`: uses `parseFirstAndRest` to split ticket key from raw comment body
- **section-06-solve-handler** (`src/commands/solve.ts`): uses `parseArgs` for ticket key extraction and `splitMessage` to split Claude's response before sending.

Handlers import these utilities via relative paths, e.g.:
```typescript
import { parseArgs, parseFirstAndRest } from '../utils/parseArgs'
import { splitMessage } from '../utils/splitMessage'
```