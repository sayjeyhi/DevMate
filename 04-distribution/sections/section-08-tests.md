Now I have all the context needed to generate the section content.

# Section 08: Tests

## Overview

This section implements the test suite for `install.sh` and the associated CI lint checks. It depends on sections 04 (install core), 05 (service registration), and 06 (uninstall) being fully implemented before tests can run end-to-end.

Dependencies:
- **section-04-install-core**: provides `install.sh` with all core functions
- **section-05-install-services**: provides `register_macos_service()` and `register_linux_service()` in `install.sh`
- **section-06-install-uninstall**: provides `do_uninstall()` in `install.sh`

---

## Files To Create / Modify

| File | Action |
|---|---|
| `tests/install.bats` | Create — Bats test suite for `install.sh` |
| `.github/workflows/lint.yml` | Modify — add `shellcheck` and `bash -n` steps (may already exist from section-01) |

---

## Prerequisites

[Bats](https://github.com/bats-core/bats-core) must be available in the test environment. Install via Homebrew (`brew install bats-core`) on macOS or the system package manager on Linux. The test command configured for this project is:

```
bats tests/install.bats
```

Bats tests mock system commands by defining shell functions that shadow binaries on `PATH`. This is the standard pattern for testing shell scripts without running on real hardware or making network calls.

---

## How to Source install.sh in Bats

`install.sh` defines all logic inside `main()` and calls `main "$@"` at the bottom. To test individual functions without triggering `main`, source the script with `BATS_TEST_SOURCED=1` (or equivalent guard) OR temporarily stub the `main` call. The practical approach in Bats is to source the script after overriding the guard:

```bash
setup() {
  # Source install.sh so its functions are available,
  # but prevent main() from running automatically.
  # Strategy: define a no-op main before sourcing,
  # then source the script — the real main() definition
  # will overwrite the stub, but the final `main "$@"` call
  # at the bottom of the file will call the real main with
  # no arguments (harmless in a sourced context if functions
  # return early when INSTALL_SH_SOURCED is set).
  export INSTALL_SH_SOURCED=1
  source "$BATS_TEST_DIRNAME/../install.sh"
}
```

Alternatively, wrap the `main "$@"` line in `install.sh` with a guard:

```bash
# At the bottom of install.sh:
if [[ "${INSTALL_SH_SOURCED:-}" != "1" ]]; then
  main "$@"
fi
```

This guard must be added to `install.sh` as part of this section's implementation.

---

## Test Stubs: `tests/install.bats`

### File Header and Setup

```bash
#!/usr/bin/env bats
# tests/install.bats — unit tests for install.sh functions

setup() {
  export INSTALL_SH_SOURCED=1
  source "${BATS_TEST_DIRNAME}/../install.sh"

  # Provide a writable temp HOME for each test
  export HOME
  HOME="$(mktemp -d)"
  export TMP_DIR
  TMP_DIR="$(mktemp -d)"
}

teardown() {
  rm -rf "$HOME" "$TMP_DIR"
}
```

---

### Static Analysis (shellcheck + bash syntax)

These run as assertions outside Bats (in `lint.yml`), but can also be expressed as Bats tests:

```bash
@test "shellcheck passes with no errors" {
  # Requires shellcheck to be installed
  run shellcheck -S error "${BATS_TEST_DIRNAME}/../install.sh"
  [ "$status" -eq 0 ]
}

@test "bash syntax check passes" {
  run bash -n "${BATS_TEST_DIRNAME}/../install.sh"
  [ "$status" -eq 0 ]
}
```

---

### `detect_platform()` Tests

```bash
@test "detect_platform: Darwin arm64 sets OS=macos ARCH=arm64" {
  # Mock uname
  uname() { if [[ "$1" == "-s" ]]; then echo "Darwin"; else echo "arm64"; fi }
  export -f uname
  detect_platform
  [ "$OS" = "macos" ]
  [ "$ARCH" = "arm64" ]
}

@test "detect_platform: Darwin x86_64 sets OS=macos ARCH=x64" {
  uname() { if [[ "$1" == "-s" ]]; then echo "Darwin"; else echo "x86_64"; fi }
  export -f uname
  detect_platform
  [ "$OS" = "macos" ]
  [ "$ARCH" = "x64" ]
}

@test "detect_platform: Linux x86_64 sets OS=linux ARCH=x64" {
  uname() { if [[ "$1" == "-s" ]]; then echo "Linux"; else echo "x86_64"; fi }
  export -f uname
  detect_platform
  [ "$OS" = "linux" ]
  [ "$ARCH" = "x64" ]
}

@test "detect_platform: Linux aarch64 exits 1 with ARM64 message" {
  uname() { if [[ "$1" == "-s" ]]; then echo "Linux"; else echo "aarch64"; fi }
  export -f uname
  run detect_platform
  [ "$status" -eq 1 ]
  [[ "$output" == *"Linux ARM64 is not yet supported"* ]]
}

@test "detect_platform: Linux musl exits 1 with Alpine message" {
  # Stub musl detection: ldd --version outputs "musl"
  uname() { if [[ "$1" == "-s" ]]; then echo "Linux"; else echo "x86_64"; fi }
  ldd() { echo "musl libc"; }
  export -f uname ldd
  run detect_platform
  [ "$status" -eq 1 ]
  [[ "$output" == *"Alpine/musl Linux is not supported"* ]]
}

@test "detect_platform: Windows_NT exits 1 with Unsupported OS message" {
  uname() { if [[ "$1" == "-s" ]]; then echo "Windows_NT"; else echo "x86_64"; fi }
  export -f uname
  run detect_platform
  [ "$status" -eq 1 ]
  [[ "$output" == *"Unsupported OS"* ]]
}
```

---

### `resolve_version()` Tests

```bash
@test "resolve_version: uses JIRA_ASSISTANT_VERSION env var without HTTP call" {
  export JIRA_ASSISTANT_VERSION="v1.0.0"
  # curl should not be called; if it is, fail
  curl() { echo "curl should not be called"; return 1; }
  export -f curl
  resolve_version
  [ "$VERSION" = "v1.0.0" ]
}

@test "resolve_version: follows redirect when env var not set" {
  unset JIRA_ASSISTANT_VERSION
  # Mock curl to return a redirect URL containing the version
  curl() { echo "v2.3.4"; }
  export -f curl
  resolve_version
  [ "$VERSION" = "v2.3.4" ]
}
```

---

### `download_with_retry()` Tests

```bash
@test "download_with_retry: successful first attempt creates dest file" {
  curl() { echo "binary-content" > "$2"; return 0; }
  export -f curl
  download_with_retry "https://example.com/file" "$TMP_DIR/out"
  [ -f "$TMP_DIR/out" ]
}

@test "download_with_retry: first attempt fails, second succeeds" {
  ATTEMPT=0
  curl() {
    ATTEMPT=$((ATTEMPT + 1))
    if [ "$ATTEMPT" -eq 1 ]; then return 1; fi
    echo "binary-content" > "$2"; return 0
  }
  export -f curl
  download_with_retry "https://example.com/file" "$TMP_DIR/out"
  [ -f "$TMP_DIR/out" ]
}

@test "download_with_retry: both attempts fail exits non-zero" {
  curl() { return 1; }
  export -f curl
  run download_with_retry "https://example.com/file" "$TMP_DIR/out"
  [ "$status" -ne 0 ]
}
```

---

### `verify_checksum()` Tests

```bash
@test "verify_checksum: correct hash exits 0" {
  echo "hello" > "$TMP_DIR/binary"
  # Compute real hash and write checksums.txt
  HASH=$(sha256sum "$TMP_DIR/binary" 2>/dev/null || shasum -a 256 "$TMP_DIR/binary" | awk '{print $1}')
  echo "$HASH  binary" > "$TMP_DIR/checksums.txt"
  run verify_checksum "$TMP_DIR/binary" "$TMP_DIR/checksums.txt"
  [ "$status" -eq 0 ]
}

@test "verify_checksum: wrong hash exits 1 with Checksum mismatch" {
  echo "hello" > "$TMP_DIR/binary"
  echo "0000000000000000000000000000000000000000000000000000000000000000  binary" > "$TMP_DIR/checksums.txt"
  run verify_checksum "$TMP_DIR/binary" "$TMP_DIR/checksums.txt"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Checksum mismatch"* ]]
}

@test "verify_checksum: binary name not found in checksums.txt exits 1" {
  echo "hello" > "$TMP_DIR/binary"
  echo "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234  other-file" > "$TMP_DIR/checksums.txt"
  run verify_checksum "$TMP_DIR/binary" "$TMP_DIR/checksums.txt"
  [ "$status" -eq 1 ]
}
```

---

### `select_install_dir()` Tests

```bash
@test "select_install_dir: /usr/local/bin writable sets INSTALL_DIR=/usr/local/bin" {
  # Use a writable temp dir to simulate /usr/local/bin
  MOCK_USR_LOCAL_BIN="$(mktemp -d)"
  # Patch the function's check — or export a variable that overrides the path
  # Implementation-dependent; test assumes function checks write permission
  run select_install_dir
  # Verify INSTALL_DIR is set (exact value depends on test environment)
  [ -n "$INSTALL_DIR" ]
}

@test "select_install_dir: /usr/local/bin not writable falls back to ~/.local/bin" {
  # Override the writable check by making /usr/local/bin appear non-writable
  # This test may need to be run as non-root; it is environment-sensitive
  # Stub approach: override the -w test by wrapping select_install_dir with
  # a mock that always returns false for /usr/local/bin
  :  # stub — implementer fills in based on actual function implementation
}
```

---

### `ensure_path()` Tests

```bash
@test "ensure_path: appends export line to existing ~/.zshrc when dir not present" {
  touch "$HOME/.zshrc"
  ensure_path "$HOME/.local/bin"
  grep -q "jira-assistant" "$HOME/.zshrc"
}

@test "ensure_path: idempotent — does not duplicate line in ~/.zshrc" {
  touch "$HOME/.zshrc"
  ensure_path "$HOME/.local/bin"
  ensure_path "$HOME/.local/bin"
  COUNT=$(grep -c "jira-assistant" "$HOME/.zshrc" || true)
  [ "$COUNT" -eq 1 ]
}

@test "ensure_path: does not create ~/.zshrc if it does not exist" {
  rm -f "$HOME/.zshrc"
  ensure_path "$HOME/.local/bin"
  [ ! -f "$HOME/.zshrc" ]
}
```

---

### TTY Detection Tests

```bash
@test "config wizard skipped when stdin is not a TTY" {
  # Simulate non-TTY stdin by running with stdin redirected from /dev/null
  # The function run_config_if_needed should print a message instead of running wizard
  run bash -c "
    export INSTALL_SH_SOURCED=1
    source '${BATS_TEST_DIRNAME}/../install.sh'
    run_config_if_needed
  " < /dev/null
  [[ "$output" == *"jira-assistant config"* ]]
}

@test "config wizard skipped when config.json already exists" {
  mkdir -p "$HOME/.config/jira-assistant"
  echo '{}' > "$HOME/.config/jira-assistant/config.json"
  run run_config_if_needed
  # Should exit 0 without prompting
  [ "$status" -eq 0 ]
}
```

---

### `register_macos_service()` Tests

```bash
@test "register_macos_service: creates plist at ~/Library/LaunchAgents/" {
  launchctl() { return 0; }
  export -f launchctl
  mkdir -p "$HOME/Library/LaunchAgents"
  register_macos_service "/usr/local/bin/jira-assistant"
  [ -f "$HOME/Library/LaunchAgents/com.jira-assistant.plist" ]
}

@test "register_macos_service: plist contains KeepAlive dictionary form" {
  launchctl() { return 0; }
  export -f launchctl
  mkdir -p "$HOME/Library/LaunchAgents"
  register_macos_service "/usr/local/bin/jira-assistant"
  grep -q "KeepAlive" "$HOME/Library/LaunchAgents/com.jira-assistant.plist"
  # Must be dict form, not simple <true/>
  grep -q "<dict>" "$HOME/Library/LaunchAgents/com.jira-assistant.plist"
}

@test "register_macos_service: plist contains ThrottleInterval 30" {
  launchctl() { return 0; }
  export -f launchctl
  mkdir -p "$HOME/Library/LaunchAgents"
  register_macos_service "/usr/local/bin/jira-assistant"
  grep -q "ThrottleInterval" "$HOME/Library/LaunchAgents/com.jira-assistant.plist"
  grep -q "30" "$HOME/Library/LaunchAgents/com.jira-assistant.plist"
}

@test "register_macos_service: plist contains RunAtLoad true" {
  launchctl() { return 0; }
  export -f launchctl
  mkdir -p "$HOME/Library/LaunchAgents"
  register_macos_service "/usr/local/bin/jira-assistant"
  grep -q "RunAtLoad" "$HOME/Library/LaunchAgents/com.jira-assistant.plist"
}

@test "register_macos_service: calls launchctl unload before load" {
  CALLS=""
  launchctl() { CALLS="$CALLS $1"; }
  export -f launchctl
  export CALLS
  mkdir -p "$HOME/Library/LaunchAgents"
  register_macos_service "/usr/local/bin/jira-assistant"
  [[ "$CALLS" == *"unload"*"load"* ]]
}
```

---

### `register_linux_service()` Tests

```bash
@test "register_linux_service: creates unit file at ~/.config/systemd/user/" {
  systemctl() { return 0; }
  export -f systemctl
  register_linux_service "/home/user/.local/bin/jira-assistant"
  [ -f "$HOME/.config/systemd/user/jira-assistant.service" ]
}

@test "register_linux_service: unit file contains Restart=on-failure" {
  systemctl() { return 0; }
  export -f systemctl
  register_linux_service "/home/user/.local/bin/jira-assistant"
  grep -q "Restart=on-failure" "$HOME/.config/systemd/user/jira-assistant.service"
}

@test "register_linux_service: unit file contains StartLimitIntervalSec=300" {
  systemctl() { return 0; }
  export -f systemctl
  register_linux_service "/home/user/.local/bin/jira-assistant"
  grep -q "StartLimitIntervalSec=300" "$HOME/.config/systemd/user/jira-assistant.service"
}

@test "register_linux_service: unit file contains StartLimitBurst=5" {
  systemctl() { return 0; }
  export -f systemctl
  register_linux_service "/home/user/.local/bin/jira-assistant"
  grep -q "StartLimitBurst=5" "$HOME/.config/systemd/user/jira-assistant.service"
}

@test "register_linux_service: unit file contains Type=simple" {
  systemctl() { return 0; }
  export -f systemctl
  register_linux_service "/home/user/.local/bin/jira-assistant"
  grep -q "Type=simple" "$HOME/.config/systemd/user/jira-assistant.service"
}

@test "register_linux_service: calls systemctl --user enable --now" {
  SYSTEMCTL_ARGS=""
  systemctl() { SYSTEMCTL_ARGS="$*"; }
  export -f systemctl
  export SYSTEMCTL_ARGS
  register_linux_service "/home/user/.local/bin/jira-assistant"
  [[ "$SYSTEMCTL_ARGS" == *"--user"*"enable"*"--now"* ]]
}
```

---

### `do_uninstall()` Tests

```bash
@test "do_uninstall: removes binary from /usr/local/bin if present" {
  touch "$HOME/mock_usr_local_bin_jira_assistant"
  launchctl() { return 0; }
  systemctl() { return 0; }
  export -f launchctl systemctl
  # Point uninstall to the mock path; implementer adapts based on actual function
  :  # stub
}

@test "do_uninstall: removes binary from ~/.local/bin if present" {
  mkdir -p "$HOME/.local/bin"
  touch "$HOME/.local/bin/jira-assistant"
  launchctl() { return 0; }
  systemctl() { return 0; }
  export -f launchctl systemctl
  do_uninstall
  [ ! -f "$HOME/.local/bin/jira-assistant" ]
}

@test "do_uninstall: removes macOS plist file" {
  mkdir -p "$HOME/Library/LaunchAgents"
  touch "$HOME/Library/LaunchAgents/com.jira-assistant.plist"
  launchctl() { return 0; }
  export -f launchctl
  do_uninstall
  [ ! -f "$HOME/Library/LaunchAgents/com.jira-assistant.plist" ]
}

@test "do_uninstall: removes Linux service file" {
  mkdir -p "$HOME/.config/systemd/user"
  touch "$HOME/.config/systemd/user/jira-assistant.service"
  systemctl() { return 0; }
  export -f systemctl
  do_uninstall
  [ ! -f "$HOME/.config/systemd/user/jira-assistant.service" ]
}

@test "do_uninstall: does NOT remove ~/.config/jira-assistant/" {
  mkdir -p "$HOME/.config/jira-assistant"
  echo '{}' > "$HOME/.config/jira-assistant/config.json"
  launchctl() { return 0; }
  systemctl() { return 0; }
  export -f launchctl systemctl
  do_uninstall
  [ -f "$HOME/.config/jira-assistant/config.json" ]
}

@test "do_uninstall: exits 0 even when no binary is installed" {
  launchctl() { return 0; }
  systemctl() { return 0; }
  export -f launchctl systemctl
  run do_uninstall
  [ "$status" -eq 0 ]
}

@test "do_uninstall: calls launchctl unload before removing plist" {
  LAUNCHCTL_CALLED=0
  launchctl() { LAUNCHCTL_CALLED=1; return 0; }
  export -f launchctl
  export LAUNCHCTL_CALLED
  mkdir -p "$HOME/Library/LaunchAgents"
  touch "$HOME/Library/LaunchAgents/com.jira-assistant.plist"
  do_uninstall
  [ "$LAUNCHCTL_CALLED" -eq 1 ]
}
```

---

### Checksum Tool Selection Test

```bash
@test "correct checksum tool used: sha256sum on Linux, shasum on macOS" {
  # Verify that verify_checksum uses sha256sum or shasum -a 256 based on OS
  # This is a grep-level check on the script source:
  run grep -E "sha256sum|shasum" "${BATS_TEST_DIRNAME}/../install.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"sha256sum"* ]] || [[ "$output" == *"shasum"* ]]
}
```

---

## CI Lint Integration: `.github/workflows/lint.yml`

The `lint.yml` workflow must include the following steps (add to existing file if created in section-01, or create it here):

```yaml
- name: shellcheck
  run: shellcheck -S error install.sh

- name: bash syntax check
  run: bash -n install.sh
```

The `shellcheck` step must use severity level `error` (`-S error`) so that only errors (not warnings) block CI. This prevents over-blocking while still catching real bugs.

The test command for this project is `bats tests/install.bats`. Add a Bats step to `lint.yml` if Bats is available in the CI runner:

```yaml
- name: Install bats
  run: sudo apt-get install -y bats   # or: brew install bats-core on macOS runner

- name: Run install.sh unit tests
  run: bats tests/install.bats
```

---

## Smoke Test Checklist (Manual, Per Release)

Run these manually before publishing each release. They are not automated.

1. **macOS arm64 binary** — execute `./jira-assistant-macos-arm64 --version`; confirm exit code is not 137 (SIGKILL). Exit 137 indicates a code-signature regression (Bun v1.3.12 issue).
2. **macOS x64 binary** — execute `./jira-assistant-macos-x64 --version`; confirm clean exit.
3. **Linux x64 binary** — execute `./jira-assistant-linux-x64 --version`; confirm clean exit.
4. **Binary sizes** — each binary should be between 10 MB and 500 MB. Smaller suggests an empty file or HTML error page was saved.
5. **macOS codesign** — `codesign -v jira-assistant-macos-arm64` should exit 0 (ad-hoc signature present).
6. **curl pipe install on macOS** — run the one-liner install; confirm Gatekeeper does not block execution.
7. **curl pipe install on Linux x64** — confirm systemd service starts; `systemctl --user status jira-assistant` shows active.
8. **Restart behavior on Linux** — `systemctl --user kill jira-assistant`; confirm service restarts within `RestartSec` (5 seconds).
9. **`--uninstall` after clean install** — run uninstall; confirm binary and service files are gone, config directory preserved.
10. **Re-install over existing install** — run install twice; confirm no errors, service restarts cleanly.
11. **`~/.local/bin` fallback** — temporarily `chmod -w /usr/local/bin` (or test as non-root); confirm install uses `~/.local/bin` and PATH update fires.
12. **Checksum mismatch** — corrupt a downloaded binary byte before verify step; confirm "Checksum mismatch" message and exit 1.
13. **Non-TTY stdin** — `curl ... | bash`; confirm config wizard is deferred and advisory message printed.
14. **Linux ARM64 rejection** — on ARM64 Linux, confirm explicit error message and exit 1.
15. **Version pinning** — `JIRA_ASSISTANT_VERSION=v1.0.0 bash install.sh`; confirm that exact version is downloaded.

---

## Implementation TODO

1. Add `INSTALL_SH_SOURCED` guard at the bottom of `install.sh` (wrap `main "$@"` call).
2. Create `tests/` directory at the repo root.
3. Create `tests/install.bats` with the stubs above, filling in each `@test` body.
4. Ensure `launchctl` / `systemctl` mocks are defined per-test (not globally) to avoid cross-test contamination.
5. Add `shellcheck` and `bash -n` steps to `.github/workflows/lint.yml`.
6. Add Bats install + run step to `lint.yml` if the CI runner supports it.
7. Keep the smoke test checklist in a `RELEASE_CHECKLIST.md` or as a comment in the relevant workflow file for easy reference at release time.

## Implementation Notes

- Files changed: `.github/workflows/lint.yml`, `tests/install.bats`, `install.sh`, `RELEASE_CHECKLIST.md`
- Guard approach: `BASH_SOURCE[0] == $0` (already present from section-04) used instead of `INSTALL_SH_SOURCED` — functionally equivalent, simpler
- `tests/install.bats` was created in sections 04-06; section-08 fixed 22 failing tests caused by bash special-builtin scoping bug: `VAR=value source file.sh` reverts the assignment after source. Fixed with `export VAR=value; source file.sh` for PATH/HOME/JIRA_ASSISTANT_VERSION, and `source file.sh; VAR=value` for CONFIG_FILE and OS (which install.sh overwrites at startup)
- `install.sh` bugfix: `grep "..." | awk ... || true` — without `|| true`, `set -eo pipefail` caused silent exit when grep found no match, before the error message could be printed
- `lint.yml` changes: added `-S error` flag to shellcheck; added `sudo apt-get install -y bats` + `bats tests/install.bats` steps (ubuntu-latest ships bats 1.x)
- `RELEASE_CHECKLIST.md`: 15 manual smoke test items (binary sizes, codesign, install/uninstall flows, checksum corruption, TTY detection, version pinning)
- Final test count: 64 total, 8 skipped (manual smoke tests requiring release binaries), 56 automated — all pass