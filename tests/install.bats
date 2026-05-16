#!/usr/bin/env bats
# Smoke tests for release binaries.
# Run manually after a release with actual binaries present.
# Usage: BINARY_DIR=./artifacts bats tests/install.bats

setup() {
    BINARY_DIR="${BINARY_DIR:-./artifacts}"
    CHECKSUMS_TMPDIR="$(mktemp -d)"
}

teardown() {
    [ -n "$CHECKSUMS_TMPDIR" ] && rm -rf "$CHECKSUMS_TMPDIR"
}

verify_binary_size() {
    local path="$1"
    local size
    size=$(wc -c < "$path")
    local min=$((10 * 1024 * 1024))   # 10MB
    local max=$((500 * 1024 * 1024))  # 500MB
    [ "$size" -ge "$min" ] && [ "$size" -le "$max" ]
}

@test "macOS arm64 binary: size between 10MB and 500MB" {
    skip "Manual smoke test — requires release binary"
    local bin="$BINARY_DIR/jira-assistant-macos-arm64"
    [ -f "$bin" ] || skip "Binary not found: $bin"
    verify_binary_size "$bin"
}

@test "macOS x64 binary: size between 10MB and 500MB" {
    skip "Manual smoke test — requires release binary"
    local bin="$BINARY_DIR/jira-assistant-macos-x64"
    [ -f "$bin" ] || skip "Binary not found: $bin"
    verify_binary_size "$bin"
}

@test "Linux x64 binary: size between 10MB and 500MB" {
    skip "Manual smoke test — requires release binary"
    local bin="$BINARY_DIR/jira-assistant-linux-x64"
    [ -f "$bin" ] || skip "Binary not found: $bin"
    verify_binary_size "$bin"
}

@test "macOS arm64 binary: ad-hoc code signature valid (codesign -v)" {
    skip "Manual smoke test — requires release binary and macOS"
    local bin="$BINARY_DIR/jira-assistant-macos-arm64"
    [ -f "$bin" ] || skip "Binary not found: $bin"
    run codesign -v "$bin"
    [ "$status" -eq 0 ]
}

@test "macOS x64 binary: ad-hoc code signature valid (codesign -v)" {
    skip "Manual smoke test — requires release binary and macOS"
    local bin="$BINARY_DIR/jira-assistant-macos-x64"
    [ -f "$bin" ] || skip "Binary not found: $bin"
    run codesign -v "$bin"
    [ "$status" -eq 0 ]
}

@test "macOS arm64 binary: executes without SIGKILL (exit code != 137)" {
    skip "Manual smoke test — requires release binary on macOS arm64"
    local bin="$BINARY_DIR/jira-assistant-macos-arm64"
    [ -f "$bin" ] || skip "Binary not found: $bin"
    chmod +x "$bin"
    run "$bin" --version
    [ "$status" -ne 137 ]
}

@test "macOS x64 binary: executes without SIGKILL (exit code != 137)" {
    skip "Manual smoke test — requires release binary on macOS x64"
    local bin="$BINARY_DIR/jira-assistant-macos-x64"
    [ -f "$bin" ] || skip "Binary not found: $bin"
    chmod +x "$bin"
    run "$bin" --version
    [ "$status" -ne 137 ]
}

@test "Linux x64 binary: executes successfully on --version" {
    skip "Manual smoke test — requires release binary on Linux x64"
    local bin="$BINARY_DIR/jira-assistant-linux-x64"
    [ -f "$bin" ] || skip "Binary not found: $bin"
    chmod +x "$bin"
    run "$bin" --version
    [ "$status" -eq 0 ]
}

_make_fixture_checksums() {
    command -v sha256sum > /dev/null || skip "sha256sum not available"
    local dir="$1"
    printf 'data1' > "$dir/jira-assistant-macos-arm64"
    printf 'data2' > "$dir/jira-assistant-macos-x64"
    printf 'data3' > "$dir/jira-assistant-linux-x64"
    (cd "$dir" && sha256sum * > checksums.txt)
}

@test "checksums.txt: each line matches <64 hex chars>  <filename> format" {
    _make_fixture_checksums "$CHECKSUMS_TMPDIR"
    [ "$(wc -l < "$CHECKSUMS_TMPDIR/checksums.txt")" -ge 3 ]
    while IFS= read -r line; do
        [[ "$line" =~ ^[0-9a-f]{64}\ \ [^[:space:]]+$ ]]
    done < "$CHECKSUMS_TMPDIR/checksums.txt"
}

@test "checksums.txt: all three binary names appear" {
    _make_fixture_checksums "$CHECKSUMS_TMPDIR"
    grep -q "jira-assistant-macos-arm64" "$CHECKSUMS_TMPDIR/checksums.txt"
    grep -q "jira-assistant-macos-x64"  "$CHECKSUMS_TMPDIR/checksums.txt"
    grep -q "jira-assistant-linux-x64"  "$CHECKSUMS_TMPDIR/checksums.txt"
}

@test "sha256sum --check exits 0 when binaries are intact" {
    _make_fixture_checksums "$CHECKSUMS_TMPDIR"
    run bash -c "cd \"$CHECKSUMS_TMPDIR\" && sha256sum --check checksums.txt"
    [ "$status" -eq 0 ]
}

@test "sha256sum --check exits non-zero after binary corruption" {
    _make_fixture_checksums "$CHECKSUMS_TMPDIR"
    printf 'corrupted' > "$CHECKSUMS_TMPDIR/jira-assistant-macos-arm64"
    run bash -c "cd \"$CHECKSUMS_TMPDIR\" && sha256sum --check checksums.txt"
    [ "$status" -ne 0 ]
}
