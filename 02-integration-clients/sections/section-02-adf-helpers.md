Now I have all the context needed. Let me generate the complete section content for `section-02-adf-helpers`.

# Section 02: ADF Helpers

## Overview

This section implements two pure utility functions in `src/jira/adf.ts`. There are no external dependencies, no network calls, no mocks needed for tests. The functions convert between plain text and Atlassian Document Format (ADF), which is the JSON document format Jira Cloud REST API v3 uses for rich text fields (descriptions and comments).

This section depends on **section-01-foundation** (project scaffolding, `tsconfig.json`, `package.json`, `vitest.config.ts`) being complete before starting. It blocks **section-04-jira** which imports `toADF` and `adfToText`.

---

## Background: Atlassian Document Format (ADF)

Jira Cloud REST API v3 does not accept plain strings for description and comment fields. It requires ADF, a recursive JSON document tree. The two functions in this section bridge that gap:

- `toADF(text)` — wraps plain text into an ADF document so it can be sent to Jira.
- `adfToText(node)` — extracts plain text from an ADF document received from Jira.

A minimal ADF document looks like:

```json
{
  "version": 1,
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "Hello world" }
      ]
    }
  ]
}
```

Node types that must be handled by `adfToText`:
- `text` — leaf node, has a `text` string field
- `hardBreak` — line break, no children
- `paragraph` — block node, has `content` array
- `heading` — block node, has `content` array
- `blockquote` — block node, has `content` array
- `listItem` — block node, has `content` array
- `bulletList` — container, has `content` array of `listItem`
- `orderedList` — container, has `content` array of `listItem`
- `codeBlock` — block, has `content` array (children are `text` nodes)
- `mention` — inline, has `attrs.text` for the mentioned user's display name
- `doc` — root node, has `content` array of top-level blocks
- Unknown type — recurse into `content` if present, else return `""`

---

## Files to Create

### `src/jira/adf.ts`

This is the only production file for this section.

```typescript
/**
 * Atlassian Document Format (ADF) helpers.
 * Pure utility functions — no external dependencies.
 */

/** Minimal ADF node shape. Used for both input and output. */
export interface AdfNode {
  type: string
  text?: string
  content?: AdfNode[]
  attrs?: Record<string, unknown>
}

/**
 * toADF(text)
 *
 * Converts a plain text string into an ADF `doc` node.
 * Each non-empty line in the input becomes a separate `paragraph` node.
 * Empty lines (after splitting on `\n`) are skipped — they act as natural
 * paragraph breaks but produce no empty paragraph nodes in the ADF output.
 *
 * @param text - Plain text to convert. May contain `\n` line separators.
 * @returns A complete ADF doc node ready to be sent to the Jira REST API.
 *
 * Example:
 *   toADF("line1\nline2") → doc with two paragraph nodes
 *   toADF("a\n\nb")       → doc with two paragraph nodes (empty line skipped)
 *   toADF("")             → doc with empty content array
 */
export function toADF(text: string): AdfNode { ... }

/**
 * adfToText(node)
 *
 * Recursively walks an ADF node tree and extracts plain text.
 * Returns "" for null/undefined input — handles Jira issues with no description.
 *
 * Node type handling:
 * - `text`        → return node.text value
 * - `hardBreak`   → return "\n"
 * - `paragraph`, `heading`, `blockquote`, `listItem`
 *                 → join children with "", append trailing "\n"
 * - `bulletList`, `orderedList` → recurse into content items (no extra separator)
 * - `codeBlock`   → extract text from children, return with trailing "\n"
 * - `mention`     → return `@<attrs.text>` or `@user` if attrs.text absent
 * - `doc`         → join top-level blocks with "\n", then trim
 * - unknown type  → recurse into content if present, else return ""
 *
 * @param node - ADF node (or null/undefined).
 * @returns Plain text string. Leading/trailing whitespace stripped from final result.
 */
export function adfToText(node: AdfNode | null | undefined): string { ... }
```

---

## Tests to Write First

File: `tests/adf.test.ts`

These are pure unit tests. No mocks, no async, no network.

### `toADF` test cases

```typescript
describe('toADF', () => {
  it('single line → one paragraph with one text node containing that string')
  it('two lines separated by \\n → two paragraph nodes')
  it('empty line between two lines (a\\n\\nb) → two paragraphs, empty line skipped')
  it('empty string input → doc with empty content array (graceful, no crash)')
  it('returned doc has type === "doc" and version === 1')
  it('each paragraph has type === "paragraph" with content array')
  it('each text node has type === "text" with the correct text value')
})
```

Concrete assertion examples for the implementer:

- `toADF("hello").type` must equal `"doc"`
- `toADF("hello").content` must have length 1
- `toADF("hello").content[0].type` must equal `"paragraph"`
- `toADF("hello").content[0].content[0]` must deep-equal `{ type: "text", text: "hello" }`
- `toADF("a\nline2").content` must have length 2
- `toADF("a\n\nb").content` must have length 2 (not 3)
- `toADF("").content` must have length 0

### `adfToText` test cases

```typescript
describe('adfToText', () => {
  it('null input → returns ""')
  it('undefined input → returns ""')
  it('single text node → returns its text value')
  it('paragraph containing text node → returns the text value')
  it('two paragraphs → text joined with newline')
  it('hardBreak node inside paragraph → produces \\n in output')
  it('bulletList with listItem nodes → recurses and returns list item text')
  it('orderedList with listItem nodes → recurses and returns list item text')
  it('codeBlock node → returns text content')
  it('mention node with attrs.text → returns "@<attrs.text>"')
  it('mention node without attrs.text → returns "@user"')
  it('unknown node type with content → recurses into content')
  it('unknown node type without content → returns ""')
  it('doc node → joins top-level blocks and trims')
  it('real-world ADF: paragraph + bulletList + heading → correct flat text extraction')
})
```

Concrete assertion examples:

- `adfToText(null)` must equal `""`
- `adfToText(undefined)` must equal `""`
- `adfToText({ type: "text", text: "hello" })` must equal `"hello"`
- `adfToText({ type: "hardBreak" })` must equal `"\n"`
- `adfToText({ type: "paragraph", content: [{ type: "text", text: "hi" }] })` must equal `"hi\n"`
- `adfToText({ type: "mention", attrs: { text: "Alice" } })` must equal `"@Alice"`
- `adfToText({ type: "mention", attrs: {} })` must equal `"@user"`
- For a `doc` node containing two paragraphs `"line1"` and `"line2"`, the result after trimming must equal `"line1\n\nline2"` (each paragraph adds `\n`, then `doc` joins with `\n`)

---

## Implementation Notes

### `toADF` algorithm

1. Split `text` on `"\n"`.
2. Filter out empty strings from the resulting array.
3. Map each remaining line to a `paragraph` node with one `text` child.
4. Return `{ version: 1, type: "doc", content: paragraphs }`.

The `version: 1` field is required by the Jira API. The `AdfNode` interface above does not include `version` — the return type can be widened to include it, or the interface can be augmented with an optional `version?: number` field.

### `adfToText` algorithm

Structure the function as a switch on `node.type`. For block-level types (`paragraph`, `heading`, `blockquote`, `listItem`), the pattern is:

```
(node.content ?? []).map(child => adfToText(child)).join("") + "\n"
```

For container types (`bulletList`, `orderedList`, `doc`), recurse into `content` items and join. For `doc`, also call `.trim()` on the final result before returning.

The null/undefined guard must be the very first thing in the function body — before any property access.

### Edge Cases to Handle

- `toADF` must not produce empty paragraph nodes for blank lines. Filter before mapping.
- `adfToText` must handle nodes with no `content` field (e.g., leaf nodes, `hardBreak`). Use `?? []` when accessing `content`.
- `mention` nodes may have `attrs.text` absent or an empty string. Default to `"@user"` in that case.
- The final string from `adfToText` on a `doc` node should be trimmed to remove leading/trailing whitespace that accumulates from trailing `\n` on block nodes.

---

## Dependency on Section 01

Before starting this section, confirm that **section-01-foundation** has been completed:

- `package.json` with `vitest` in `devDependencies` exists at the project root (`02-integration-clients/package.json`)
- `tsconfig.json` is present and configured for `src/` path resolution
- `vitest.config.ts` is present and points to the `tests/` directory
- `src/errors.ts` exists (not directly needed here, but confirms the `src/` tree is initialized)

The ADF helpers have no runtime imports. The only import in `adf.ts` will be the `AdfNode` interface — which is defined in the same file.

---

## Checklist for Implementer

- [x] Create `src/jira/adf.ts` with `AdfNode` interface, `toADF`, and `adfToText` exports
- [x] Create `tests/adf.test.ts` with all test cases listed above
- [x] Run `vitest run tests/adf.test.ts` — all tests should fail (red phase)
- [x] Implement `toADF` — split, filter empty, map to ADF paragraph nodes, return doc
- [x] Implement `adfToText` — null guard first, switch on node type, handle all listed types
- [x] Run `vitest run tests/adf.test.ts` — all tests should pass (green phase)
- [x] Confirm `toADF(adfToText(someAdfDoc))` round-trip produces equivalent text for a sample input

## Implementation Notes (Actual)

**Status: COMPLETE — 24/24 tests passing (36 total across 2 test files)**

### Files Created

- `02-integration-clients/src/jira/adf.ts` — `AdfNode` interface, `toADF`, `adfToText`
- `02-integration-clients/tests/adf.test.ts` — 24 tests (7 for toADF, 16 for adfToText, 1 round-trip)

### Deviations from Plan

- `toADF` trims each line before filtering — whitespace-only lines skipped (review finding + user approval)
- `adfToText` default branch uses `(node.content ?? [])` null-guard (review finding)
- Added JSDoc to exported functions (review finding)
- Added round-trip test (review finding from spec checklist)
- `AdfNode` interface includes `version?: number` field

### Key Behaviors

- `toADF('a\n   \nb')` → 2 paragraphs (whitespace-only line skipped)
- `adfToText(null/undefined)` → `""`
- `doc` node: `.join('\n').trim()` — each paragraph block emits trailing `\n`, join adds `\n` between = double newline between paragraphs in doc output
- `mention` with empty `attrs.text` → `"@user"`