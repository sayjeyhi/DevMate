Now I have all the context needed. Let me generate the section content for `section-04-install-core`.

# section-04-install-core

## Overview

This section implements the core structure of `install.sh` — the one-command installer that users pipe through bash. It covers the script skeleton, safety patterns, platform detection, version resolution, download with retry, checksum verification, binary installation, quarantine stripping, PATH management, and the config wizard TTY gate. Service registration and uninstall are handled in sections 05 and 06 respectively; this section stubs those function signatures and calls them at the appropriate points within `main()`.

**Dependencies required before starting this section:**
- `section-02-binary-targets` — defines the binary naming convention (`jira-assistant-${OS}-${ARCH}`) and the three platform targets
- `section-03-checksums-generation` — defines the `checksums.txt` format (`<64 hex chars>  <filename>`) that `verify_checksum()` parses

**Blocks:** sections 05 (service registration), 06 (uninstall), 07 (README), 08 (tests).

---

## File to Create

**`install.sh`** — at the repository root.

---

## Tests First

These tests live in `tests/install.bats`. Write the stubs before implementing the functions. Bats tests mock system commands by defining shell functions that shadow PATH entries.

### Static Analysis

```
shellcheck -S error install.sh  → exits 0 (no shellcheck errors at severity "error")
bash -n install.sh              → exits 0 (syntax valid)
```

### `detect_platform()`

```
uname -s=Darwin, uname -m=arm64     → OS=macos, ARCH=arm64
uname -s=Darwin, uname -m=x86_64   → OS=macos, ARCH=x64
uname -s=Linux,  uname -m=x86_64   → OS=linux, ARCH=x64
uname -s=Linux,  uname -m=aarch64  → exits 1, stderr contains "Linux ARM64 is not yet supported"
uname -s=Linux + musl ldd output   → exits 1, stderr contains "Alpine/musl Linux is not supported"
uname -s=Windows_NT                 → exits 1, stderr contains "Unsupported OS"
```

### `resolve_version()`

```
JIRA_ASSISTANT_VERSION=v1.0.0 set → VERSION=v1.0.0, no HTTP call made
env var not set                    → script follows /releases/latest redirect and parses tag from URL
```

### `download_with_retry(url, dest)`

```
mock curl succeeds first try   → dest file exists, exits 0
mock curl fails first try, succeeds second → dest file exists, exits 0
mock curl fails both tries     → exits non-zero
```

### `verify_checksum(binary, checksums_file)`

```
checksums.txt contains correct hash for binary → exits 0
checksums.txt contains wrong hash              → exits 1, output contains "Checksum mismatch"
binary name not present in checksums.txt       → exits 1, clear error message
correct hash tool selected: sha256sum on Linux, shasum -a 256 on macOS
checksums.txt download failure                 → exits 1 with error (does not silently skip)
```

### `select_install_dir()`

```
/usr/local/bin is writable   → INSTALL_DIR=/usr/local/bin
/usr/local/bin not writable  → INSTALL_DIR=$HOME/.local/bin
```

### `ensure_path(dir)`

```
dir not yet in ~/.zshrc      → export line appended with marker comment
dir already in ~/.zshrc      → no duplicate appended (idempotent check via marker)
~/.zshrc does not exist      → file is NOT created (only update existing RC files)
```

### TTY detection (config wizard gate)

```
stdin is not a TTY ([ ! -t 0 ]) → wizard skipped, message "Run `jira-assistant config` to complete setup." printed
~/.config/jira-assistant/config.json already exists → wizard skipped
```

### `main()` wrapper safety

```
piping a truncated script through bash → no side effects executed
(validates that all logic is inside main() and only called after full download)
```

---

## Implementation Details

### Script Header and Safety Flags

The file must begin with:

```bash
#!/usr/bin/env bash
set -euo pipefail
```

- `#!/usr/bin/env bash` — uses bash regardless of the user's default shell
- `set -e` — abort on any non-zero exit
- `set -u` — abort on unbound variable reference
- `set -o pipefail` — abort if any command in a pipeline fails

### Temp Directory and Cleanup Trap

Declare `TMP_DIR` before the trap to avoid an unbound-variable error if the script exits before `mktemp -d` runs:

```bash
TMP_DIR=""
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
```

The `trap` fires on any exit (success, error, or signal), guaranteeing cleanup.

### `main()` Wrapper — Critical for `curl | bash`

All script logic must live inside `main()`, which is called only after the full file is parsed:

```bash
main() {
  # ... all logic here ...
}
main "$@"
```

This is the critical safety pattern for `curl | bash` use: bash only executes `main "$@"` after the entire script body is downloaded and parsed. A truncated partial download will fail at parse time rather than execute half the logic.

---

## Function Signatures and Logic

### `detect_platform()`

Sets `$OS` and `$ARCH`. Read `uname -s` for the OS and `uname -m` for the architecture.

Explicit rejection cases (all should `echo` the error to stderr and `exit 1`):

- `uname -s` is not `Darwin` or `Linux` → `"Unsupported OS: <value>. Only macOS and Linux x64 are supported."`
- `uname -s` is `Linux` and `uname -m` is `aarch64` → `"Linux ARM64 is not yet supported. Only x64 binaries are available for Linux."`
- `uname -s` is `Linux` and the system uses musl libc (detected by checking if `ldd --version 2>&1` contains the string `musl`, or checking `/etc/os-release` for Alpine) → `"Alpine/musl Linux is not supported. Bun binaries require glibc."`

Mapping:
- Darwin + arm64 → `OS=macos`, `ARCH=arm64`
- Darwin + x86_64 → `OS=macos`, `ARCH=x64`
- Linux + x86_64 → `OS=linux`, `ARCH=x64`

Note for README (handled in section 07): M-series Mac users running in a Rosetta shell will get the x64 binary — functional but suboptimal. They should use a native arm64 terminal.

### `build_binary_name()`

Sets `$BINARY`. Format: `jira-assistant-${OS}-${ARCH}`. Must be called after `detect_platform()`.

### `resolve_version()`

Sets `$VERSION`.

- If `JIRA_ASSISTANT_VERSION` env var is set and non-empty, use it directly (no HTTP call).
- Otherwise, fetch the GitHub releases `/releases/latest` redirect URL and extract the tag name from the final URL path. Use `curl -fsSL -o /dev/null -w "%{url_effective}"` against `https://github.com/sayjeyhi/jira-assistant/releases/latest`, then extract the last path component.
- Print the resolved version before any downloads.

### `stop_existing_service()`

Stops any running instance before replacing the binary. This must happen before the binary is downloaded to the install path (a running binary may be locked on some systems).

- macOS: `launchctl unload ~/Library/LaunchAgents/com.jira-assistant.plist 2>/dev/null || true`
- Linux: `systemctl --user stop jira-assistant 2>/dev/null || true`

Both commands use `|| true` so they are no-ops when no service is installed.

### `select_install_dir()`

Sets `$INSTALL_DIR`.

- Try `/usr/local/bin` first: `[ -w /usr/local/bin ]`
- If not writable, fall back to `$HOME/.local/bin` and create it if it does not exist (`mkdir -p`)
- If a previous install exists at a different directory than the newly selected one, print a warning so the user knows there may be a stale binary

### `ensure_path(dir)`

Idempotently adds `dir` to PATH in the user's shell RC files.

- Use a marker comment `# jira-assistant` to detect whether the export line was already added
- Check files: `~/.zshrc`, `~/.bashrc`, `~/.bash_profile`, `~/.profile`
- Only update a file if it already exists (do not create new RC files)
- Append the following block when the marker is absent:

```bash
# jira-assistant
export PATH="<dir>:$PATH"
```

- Also export for the current session: `export PATH="<dir>:$PATH"`

### `download_with_retry(url, dest)`

Downloads `url` to `dest`. Retry once on failure.

- Use `curl -fsSL --fail-with-body` — the `--fail-with-body` flag causes curl to exit non-zero on HTTP errors while still printing the response body (useful for diagnosing error messages from GitHub)
- If the first attempt fails, print a warning and retry once
- If the second attempt also fails, exit non-zero with a clear error message

### `verify_checksum(binary, checksums_file)`

Verifies the SHA256 hash of `binary` against `checksums_file`.

- Extract the expected hash: `grep "$(basename "$binary")" "$checksums_file" | awk '{print $1}'`
- Compute actual hash:
  - Linux: `sha256sum "$binary" | awk '{print $1}'`
  - macOS: `shasum -a 256 "$binary" | awk '{print $1}'`
- Compare strings. If mismatch: print `"Checksum mismatch — download may be corrupted. Delete $TMP_DIR and retry."` and `exit 1`
- If the binary name is not found in `checksums_file`: print a clear error and `exit 1` (do not silently skip)

The security limitation (both binary and checksums.txt come from the same release) is documented in the README. This verification guards against accidental corruption/truncation, not against a compromised release.

### `install_binary(src, dest)`

Moves the downloaded binary to the install path and makes it executable:

```bash
mv "$src" "$dest"
chmod +x "$dest"
```

### `strip_quarantine(path)` — macOS only

Removes the macOS quarantine extended attribute:

```bash
xattr -d com.apple.quarantine "$path" 2>/dev/null || true
```

Note: `curl | bash` installs do not set the quarantine bit. This handles edge cases such as manual copy after download. Run unconditionally on macOS; the `2>/dev/null || true` makes it a no-op if the attribute is not present.

### `run_config_if_needed()`

Gates the interactive config wizard:

1. If `~/.config/jira-assistant/config.json` already exists → skip wizard (no output needed)
2. If stdin is not a TTY (`[ ! -t 0 ]`) → skip wizard, print: `"Run \`jira-assistant config\` to complete setup."`
3. Otherwise → run the config wizard (the wizard reopens `/dev/tty` internally if needed to handle the `curl | bash` case)

When the wizard creates the config file, it must use `umask 077` or `chmod 600` to restrict permissions on `~/.config/jira-assistant/config.json`.

### `print_success()`

Prints a final summary including:
- Installed version
- Install directory
- Service status
- Shell restart reminder (only if PATH was modified by `ensure_path`)

---

## `main()` Execution Order

Inside `main()`, call the functions in this order:

1. Handle flags: `--uninstall` → call `do_uninstall` (stub, implemented in section 06) and exit; `--help` → print usage and exit
2. `resolve_version()`
3. `detect_platform()`
4. `build_binary_name()`
5. `select_install_dir()`
6. `ensure_path "$INSTALL_DIR"` (only if `INSTALL_DIR` is `~/.local/bin`)
7. `stop_existing_service()`
8. `download_with_retry "$RELEASE_URL/$BINARY" "$TMP_DIR/$BINARY"`
9. `download_with_retry "$RELEASE_URL/checksums.txt" "$TMP_DIR/checksums.txt"`
10. `verify_checksum "$TMP_DIR/$BINARY" "$TMP_DIR/checksums.txt"`
11. `install_binary "$TMP_DIR/$BINARY" "$INSTALL_DIR/jira-assistant"`
12. `strip_quarantine "$INSTALL_DIR/jira-assistant"` (macOS only — guard with `if [[ "$OS" == "macos" ]]`)
13. `register_macos_service` or `register_linux_service` (stub calls, implemented in section 05)
14. `run_config_if_needed()`
15. `start_service()` (stub call, implemented in section 05)
16. `print_success()`

The release base URL pattern: `https://github.com/sayjeyhi/jira-assistant/releases/download/${VERSION}`

---

## Stubs for Section 05 Functions

These functions are called from `main()` but implemented in section 05. Define them as stubs in this section so the script is syntactically complete and can be tested end-to-end:

```bash
register_macos_service() {
  : # implemented in section-05-install-services
}

register_linux_service() {
  : # implemented in section-05-install-services
}

start_service() {
  : # implemented in section-05-install-services
}
```

Similarly, `do_uninstall()` is a stub here (implemented in section 06):

```bash
do_uninstall() {
  : # implemented in section-06-install-uninstall
}
```

---

## Implementation Checklist

- [x] Create `install.sh` with `#!/usr/bin/env bash` and `set -euo pipefail`
- [x] Add `TMP_DIR=""` global + `mktemp` inside `main()` + `trap` cleanup
- [x] Wrap all logic in `main() { ... }` with `BASH_SOURCE` guard (enables sourcing for tests)
- [x] Implement `detect_platform()` with all rejection cases
- [x] Implement `build_binary_name()`
- [x] Implement `resolve_version()` with `JIRA_ASSISTANT_VERSION` env var short-circuit
- [x] Implement `stop_existing_service()` for both macOS and Linux
- [x] Implement `select_install_dir()` with `/usr/local/bin` → `~/.local/bin` fallback
- [x] Implement `ensure_path(dir)` with marker-comment idempotency, updating existing RC files only
- [x] Implement `download_with_retry(url, dest)` with one retry
- [x] Implement `verify_checksum(binary, checksums_file)` — anchored grep (`"  ${name}$"`), correct hash tool per OS
- [x] Implement `install_binary(src, dest)`
- [x] Implement `strip_quarantine(path)` (macOS only, with `|| true`)
- [x] Implement `run_config_if_needed()` with TTY detection and existing-config check
- [x] Implement `print_success()` with version, binary path, service status, PATH reminder
- [x] Add stubs for `register_macos_service`, `register_linux_service`, `start_service`, `do_uninstall`
- [x] Wire `main()` in documented order
- [x] `bash -n install.sh` passes (shellcheck not installed locally; runs in CI)
- [x] Add Bats tests for all cases in `tests/install.bats` — 21 tests added

## Actual Implementation

### Files created/modified
- `install.sh` — 223 lines, all functions implemented, BASH_SOURCE guard, stubs for sections 05/06
- `tests/install.bats` — setup/teardown extended with MOCK_BIN + FAKE_HOME; 21 section-04 tests added

### Deviations from plan
- Used `BASH_SOURCE` guard instead of bare `main "$@"` to enable test sourcing
- `TMP_DIR=$(mktemp -d)` moved into `main()` (global declaration remains) to avoid side effects on source
- verify_checksum grep anchored with `"  ${name}$"` (two-space + end-anchor) — spec text said `grep "$(basename ...)"` but unanchored matching is incorrect
- `${TMP_DIR:-<temp download directory>}` in error message for graceful test-context display
- `SERVICE_STATUS` placeholder in print_success() — section-05 will set actual value

### Test count
- 21 new section-04 tests in tests/install.bats
- Tests use `bash -c "source install.sh; function_call"` pattern with MOCK_BIN for command mocking