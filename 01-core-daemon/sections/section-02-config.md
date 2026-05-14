Now I have all the context needed to generate the section content.

# Section 02: Config System

## Overview

This section implements the configuration system for `jira-assistant`. It depends on **section-01-foundation** (which provides `shared/paths.ts` and `shared/errors.ts`) and blocks **section-05-cli-commands**.

**Files to create:**
- `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/01-core-daemon/src/config/schema.ts`
- `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/01-core-daemon/src/config/loader.ts`
- `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/01-core-daemon/src/config/wizard.ts`
- `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/01-core-daemon/tests/config/loader.test.ts`
- `/Users/sayjeyhi/Desktop/projects/github/sayjeyhi/jira-assistant/01-core-daemon/tests/config/wizard.test.ts`

**Dependencies from section-01-foundation (must exist before starting):**
- `src/shared/paths.ts` — provides `PATHS.configFile`, `PATHS.configDir`
- `src/shared/errors.ts` — provides `FriendlyError`

---

## Tests First

Test files use Bun's built-in test runner. Run with `bun test` from the `01-core-daemon/` directory.

### `tests/config/loader.test.ts`

The test file should import from `../../src/config/loader` and `../../src/shared/errors`. Use `beforeEach`/`afterEach` to create and clean up a temp directory for each test (use `mkdtemp` from `node:fs/promises` or write to `os.tmpdir()` + a unique subfolder).

Tests to implement:

**`loadConfig` — happy path:**
- Write a valid TOML string to a temp file, call `loadConfig(tempFilePath)`, assert the returned object matches `AppConfig` shape (all nested keys present, `app.log_level` defaults to `"info"` when omitted).

**`loadConfig` — missing required field:**
- Write a TOML file with `telegram.bot_token` omitted, call `loadConfig`, assert it throws a `FriendlyError`, and assert `error.message` contains ALL invalid fields, not just the first one (i.e., every ZodError issue is listed, one per line: `field: reason`).

**`loadConfig` — malformed TOML:**
- Write a file with invalid TOML syntax (e.g., `key = ` with no value), call `loadConfig`, assert it throws a `FriendlyError` that includes parse error context (line number or position info from smol-toml).

**`loadConfig` — file not found:**
- Call `loadConfig("/nonexistent/path/config.toml")`, assert it throws a `FriendlyError` and that the message mentions `jira-assistant config` (directing the user to re-run the wizard).

**`configExists`:**
- Returns `false` when file does not exist.
- Returns `true` when a valid TOML file exists at the path.

**`writeConfig` — creates missing directory:**
- Pass a path inside a directory that does not yet exist; assert the directory is created and the file is written.

**`writeConfig` — valid TOML output:**
- Call `writeConfig(validConfig, tempPath)`, then `loadConfig(tempPath)`, and assert the result is deeply equal to the original config (round-trip serialization must be lossless).

**`writeConfig` — file permissions:**
- After `writeConfig`, read the file's `stat` and assert `stat.mode & 0o777 === 0o600`. This ensures secrets are not world-readable.

**`writeConfig` — atomic write:**
- The write must use a temp file + `rename()`. To verify: either spy on `fs.rename` (confirm it is called) or verify that even if the process were interrupted after writing the temp file, the original config would remain intact. A pragmatic check is to confirm the final file's content is correct and no leftover temp files remain in the directory after a successful write.

### `tests/config/wizard.test.ts`

The wizard requires a TTY to run interactively, so it cannot be tested end-to-end in CI. The test file is intentionally minimal:

**Non-TTY guard:**
- Import `runWizard` and call it in an environment where `process.stdin.isTTY` is falsy (the CI environment). Assert it throws a `FriendlyError` (or similar error) indicating a non-interactive terminal.

**Note:** Full wizard UI tests are explicitly out of scope. Mark any additional stubs with `it.todo(...)` to document intent without failing the suite.

---

## Implementation

### `config/schema.ts`

This file is the **single source of truth** for all field validation rules. Both the Zod schema (used in `loadConfig`) and the wizard inline validators (used in `runWizard`) must reference the same regex constants and URL/email logic defined here.

Export:
- Named regex constants (`BOT_TOKEN_REGEX`, `PROJECT_KEY_REGEX`, `EMAIL_REGEX`) as `const` values so wizard validators can import them without re-stating the patterns.
- The Zod `AppConfigSchema` object schema.
- The inferred TypeScript type `AppConfig` (use `z.infer<typeof AppConfigSchema>`).

The shape of `AppConfig`:

```typescript
interface AppConfig {
  telegram: {
    bot_token: string  // must match /^\d+:[A-Za-z0-9_-]{20,}$/
  }
  jira: {
    base_url: string   // must start with "https://" and parse as a valid URL
    api_token: string  // non-empty string
    email: string      // must match standard email regex
    project_key: string // must match /^[A-Z][A-Z0-9_]+$/
  }
  claude: {
    binary_path: string // non-empty string
  }
  app: {
    log_level: "info" | "debug" | "error"  // defaults to "info" when key absent
  }
}
```

Implementation notes:
- Use `z.object({...})` for each nested section.
- For `base_url`: use `z.string().url()` combined with a `.refine()` that checks `value.startsWith("https://")`.
- For `email`: use `z.string().email()` or a `.refine()` with `EMAIL_REGEX`.
- For `bot_token`: use `z.string().regex(BOT_TOKEN_REGEX)`.
- For `project_key`: use `z.string().regex(PROJECT_KEY_REGEX)`.
- For `log_level`: use `z.enum(["info", "debug", "error"]).default("info")`.

### `config/loader.ts`

Imports: `smol-toml` (`parse`, `stringify`), Zod (via `AppConfigSchema` from `./schema`), `FriendlyError` from `../shared/errors`, `PATHS` from `../shared/paths`, `node:fs/promises` (`readFile`, `writeFile`, `rename`, `mkdir`, `chmod`, `stat`).

#### `loadConfig(configPath?: string): Promise<AppConfig>`

1. Resolve path: use `configPath ?? PATHS.configFile`.
2. Read file: use `Bun.file(resolvedPath).text()`. If this throws with `ENOENT` (or equivalent "file not found" error), throw a `FriendlyError` with message like `"Config file not found at <path>"` and hint `"Run 'jira-assistant config' to create it."`.
3. Parse TOML: call `parse(rawText)` from smol-toml. If `parse` throws, catch it and re-throw as `FriendlyError` with the parse error message included.
4. Validate: call `AppConfigSchema.safeParse(parsed)`. If `result.success === false`, collect all issues from `result.error.issues` and format them as a multi-line string (`fieldPath: message` per line). Throw a `FriendlyError` with this combined message.
5. Return `result.data`.

#### `configExists(configPath?: string): Promise<boolean>`

Use `Bun.file(configPath ?? PATHS.configFile).exists()`. Return the result. Do not throw on missing file.

#### `writeConfig(config: AppConfig, configPath?: string): Promise<void>`

1. Resolve path: use `configPath ?? PATHS.configFile`.
2. Ensure directory exists: `mkdir(dirname(resolvedPath), { recursive: true })`.
3. Serialize: call `stringify(config)` from smol-toml to produce TOML text.
4. Atomic write: write the serialized string to `resolvedPath + ".tmp"` using `writeFile`. Then call `rename(resolvedPath + ".tmp", resolvedPath)`.
5. Set permissions: call `chmod(resolvedPath, 0o600)`.

### `config/wizard.ts`

Imports: `@clack/prompts` (`intro`, `outro`, `group`, `text`, `isCancel`), `AppConfig`, the shared regex constants (`BOT_TOKEN_REGEX`, `PROJECT_KEY_REGEX`, `EMAIL_REGEX`) from `./schema`, `FriendlyError` from `../shared/errors`.

#### `runWizard(existing?: AppConfig): Promise<AppConfig>`

```typescript
/** Runs the interactive setup wizard. Returns the completed config. Throws FriendlyError in non-TTY. */
async function runWizard(existing?: AppConfig): Promise<AppConfig>
```

Implementation outline:

1. **TTY guard:** Check `process.stdin.isTTY`. If false, throw `new FriendlyError("Cannot run wizard in non-interactive mode.", "Attach a TTY or provide config manually.")`.

2. **Intro:** Call `intro("jira-assistant setup")`.

3. **Prompts (using `group()`):** Define all prompts in a single `group()` call so Ctrl+C aborts the entire sequence cleanly. Each prompt uses `text({ message, initialValue, validate })`. The `initialValue` for each field is the corresponding value from `existing` (if provided), otherwise `undefined`. Validators reference the exported regex constants from `./schema` — do not inline the patterns here.

   Fields to prompt (in order):
   - `telegram.bot_token` — validate: must match `BOT_TOKEN_REGEX`; error: `"Invalid Telegram bot token format. Expected format: 123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"`
   - `jira.base_url` — validate: must start with `https://` and parse as URL; error: `"Must be a valid HTTPS URL"`
   - `jira.api_token` — validate: non-empty; error: `"API token is required"`
   - `jira.email` — validate: must match `EMAIL_REGEX`; error: `"Must be a valid email address"`
   - `jira.project_key` — validate: must match `PROJECT_KEY_REGEX`; error: `"Must be uppercase letters only, e.g. MYPROJECT"` (this is an error, not a warning — re-prompt until valid)
   - `claude.binary_path` — auto-fill with `Bun.which("claude") ?? ""` as `initialValue` if no `existing` value; validate: check `await Bun.file(value).exists()`; error: `"File not found at this path"`

4. **Cancel handling:** After `group()` resolves, check if the result `isCancel(result)`. If so, throw a `FriendlyError("Setup cancelled.")`.

5. **Assemble config:** Build and return an `AppConfig`-shaped object from the group result. `app.log_level` is not prompted — default to `"info"` (or preserve from `existing.app.log_level` if provided).

6. **Outro:** Call `outro("Config saved!")` before returning.

**Important:** The wizard returns the config object. It does NOT write to disk. The caller (`commands/config.ts`) is responsible for calling `writeConfig`.

---

## Key Design Decisions

**Single source of truth for validators:** The regex constants exported from `schema.ts` are imported by both the Zod schema and the wizard validators. This ensures that a change to validation logic in the schema automatically propagates to the wizard's inline prompts without needing to update both places.

**Atomic write + chmod:** `writeConfig` uses a temp-file-plus-rename pattern to prevent partial writes (e.g., if the process is killed mid-write). The file permissions are set to `0o600` after the rename, protecting secrets like `bot_token` and `api_token` from being readable by other users on the same machine.

**smol-toml for serialization:** Bun has no built-in `TOML.stringify()` API. smol-toml (the fastest TOML 1.1.0 parser/serializer for JavaScript) is used for both `parse()` in `loadConfig` and `stringify()` in `writeConfig`.

**Wizard does not write:** The wizard is a pure data-gathering function. Keeping write logic in `commands/config.ts` makes the wizard independently testable and reusable (e.g., `start.ts` can call the wizard then write, or first-run setup can do the same).

**`app.log_level` is not prompted:** It is an advanced option with a sensible default. It can be edited manually in `config.toml` after setup, or preserved from an existing config when the wizard is re-run.

---

## As-Built Notes

**Deviations from plan (code review fixes applied):**

- `loader.ts`: ENOENT/EACCES error handling separated — ENOENT throws "file not found" hint, EACCES throws "permission denied". Removed fallback `.exists()` re-read (TOCTOU race fix).
- `loader.ts`: `chmod(0o600)` now runs on the `.tmp` file BEFORE `rename()` — eliminates window where config is world-readable at final path.
- `schema.ts`: Used `z.string().email()` (Zod built-in) instead of custom `EMAIL_REGEX` refine for email validation. `EMAIL_REGEX` still exported for wizard validator.
- `wizard.ts`: `binary_path` validate callback changed from `async` to synchronous `existsSync()` — `@clack/prompts` text() validate is sync-only; async validator silently passed without checking.
- `wizard.ts`: Added `{ onCancel: () => { throw new FriendlyError('Setup cancelled.') } }` to `group()` for clean Ctrl+C abort.
- `wizard.ts`: `outro` message changed from `'Config saved!'` to `'Setup complete!'` — wizard doesn't write to disk, so "saved" was misleading.
- `schema.ts` app section: Removed outer `.default({ log_level: 'info' })` double-default; now `.optional().default({ log_level: 'info' })`.

**Files created:**
- `src/config/schema.ts`
- `src/config/loader.ts`
- `src/config/wizard.ts`
- `tests/config/loader.test.ts`
- `tests/config/wizard.test.ts`

**Tests:** 12 active + 9 todo across 2 files, all active pass.