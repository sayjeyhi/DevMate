Now I have all the information needed to generate the section content for `section-02-binary-targets`.

# section-02-binary-targets

## Overview

This section covers the binary build configuration for the `jira-assistant` project. It defines the three cross-compilation targets, the pinned Bun version, the naming convention for output binaries, and the artifact upload steps within the GitHub Actions matrix build job. This section has no dependencies and can be implemented in parallel with `section-01-ci-workflow`.

The output of this section (the three compiled binaries uploaded as workflow artifacts) is a prerequisite for `section-03-checksums-generation` and `section-04-install-core`.

---

## Dependencies

- None — this section is a root node in the dependency graph.

## Blocks

- `section-03-checksums-generation` (needs all three binaries as release assets)
- `section-04-install-core` (the install script uses the binary naming convention defined here)

---

## Files to Create or Modify

- `.github/workflows/release.yml` — the `build` job matrix and its steps (shared with `section-01-ci-workflow`; that section owns the overall structure, this section fills in the matrix entries and build commands)

The entry point being compiled is `src/index.ts`, which is produced by `01-core-daemon`.

---

## Tests (Write These First)

These are smoke tests run manually once per release. They are not automated in CI (the CI validates that compilation succeeds, but runtime behavior must be verified on real or emulated hardware).

**Bats test file:** `tests/install.bats` (shared with other sections)

**Smoke test checklist (manual, per release):**

```
Smoke: macOS arm64 binary executes without SIGKILL (exit code ≠ 137)
Smoke: macOS x64 binary executes without SIGKILL
Smoke: Linux x64 binary executes and returns non-error on --version or equivalent flag
Smoke: each binary's size is between 10MB and 500MB (rules out empty file or HTML error page)
Smoke: macOS binaries are ad-hoc signed — `codesign -v jira-assistant-macos-arm64` exits 0
```

The size check can be scripted:

```bash
# stub: verify_binary_size(path)
# Asserts file size is between 10MB and 500MB.
# Usage: verify_binary_size ./jira-assistant-macos-arm64
```

The code-signature check verifies that the v1.3.12 regression (invalid ARM64 signature) is not present. If `codesign -v` exits non-zero on a macOS arm64 binary, the pinned Bun version must be re-evaluated.

---

## Build Target Configuration

The matrix defines exactly three targets. Each entry maps a Bun target flag to an output filename:

| Bun `--target` flag | Output filename |
|---|---|
| `bun-darwin-arm64` | `jira-assistant-macos-arm64` |
| `bun-darwin-x64` | `jira-assistant-macos-x64` |
| `bun-linux-x64` | `jira-assistant-linux-x64` |

The naming pattern is `jira-assistant-<os>-<arch>`. The `install.sh` script (section-04-install-core) constructs download URLs using this exact naming convention, so any change here must be mirrored there.

**Excluded targets:**
- `-baseline` variants: not needed unless users report "Illegal instruction" on older hardware
- Windows: excluded from initial release; adding it later requires only a new matrix entry with no other changes

---

## Bun Version Pinning

Bun must be pinned to **v1.3.11** via the `oven-sh/setup-bun@v2` action step.

```yaml
# In the build job steps:
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: "1.3.11"
```

**Why v1.3.11:** A regression in v1.3.12 (GitHub issue #29120, PR #29272) produces an invalid code signature on macOS ARM64 cross-compiled binaries. The binary is SIGKILL'd immediately on macOS arm64 hardware due to a failed signature check. v1.3.11 is the last version with a correctly formed ad-hoc signature.

**Update process:** Track the upstream fix. When a fix ships, run the macOS arm64 smoke test (codesign check + no SIGKILL) before updating the pinned version in the workflow.

---

## Build Command

The build command for each matrix entry:

```bash
bun build --compile --target=<BUN_TARGET> src/index.ts --outfile=<OUTPUT_FILENAME>
```

Bun's `--compile` flag:
- Bundles the TypeScript entry point and all dependencies into a single self-contained binary
- Automatically applies an ad-hoc code signature to macOS binaries (satisfying ARM64 minimum signing requirement)
- Requires no runtime on the target machine

---

## Matrix Entry Structure in `release.yml`

The `build` job in `.github/workflows/release.yml` uses a strategy matrix. Each matrix entry must define at minimum:

- `target` — the Bun cross-compilation target string
- `outfile` — the output binary filename

Example matrix shape (YAML stubs, not exhaustive):

```yaml
strategy:
  matrix:
    include:
      - target: bun-darwin-arm64
        outfile: jira-assistant-macos-arm64
      - target: bun-darwin-x64
        outfile: jira-assistant-macos-x64
      - target: bun-linux-x64
        outfile: jira-assistant-linux-x64
```

Within each matrix job, the steps are:

1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2` with `bun-version: "1.3.11"`
3. `bun install`
4. `bun build --compile --target=${{ matrix.target }} src/index.ts --outfile=${{ matrix.outfile }}`
5. `actions/upload-artifact@v4` — uploads the binary as a workflow artifact

The upload step:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: ${{ matrix.outfile }}
    path: ${{ matrix.outfile }}
```

**Critical:** Both the upload step here and the download step in the release job (`section-01-ci-workflow`) must use `actions/upload-artifact@v4` and `actions/download-artifact@v4` respectively. v3 and v4 are not cross-compatible — mixing them will cause the release job's artifact download to fail silently or with confusing errors.

---

## Ad-hoc Code Signature (macOS)

Bun's `--compile` automatically applies an ad-hoc code signature when the output binary is detected as targeting macOS. This satisfies Apple's minimum signing requirement for ARM64 binaries. Users do not need to install or run the binary through Gatekeeper if they use the `install.sh` script (curl downloads do not set the quarantine bit). Manual downloads from the Releases page do require the `xattr` workaround documented in the README.

With Bun v1.3.11, the ad-hoc signature is correctly formed. The `codesign -v` smoke test is the verification gate before each release.

---

## Implementation Checklist

1. Add the three-entry `matrix.include` block to the `build` job in `.github/workflows/release.yml`
2. Pin `bun-version: "1.3.11"` in the `oven-sh/setup-bun@v2` step
3. Write the `bun build --compile` step using `${{ matrix.target }}` and `${{ matrix.outfile }}`
4. Add the `actions/upload-artifact@v4` step using `${{ matrix.outfile }}` for both `name` and `path`
5. Confirm the `actions/download-artifact@v4` step in the release job uses `@v4` (not `@v3`)
6. Run a local compilation test: `bun build --compile --target=bun-linux-x64 src/index.ts --outfile=test-binary && ls -lh test-binary`
7. After the first real release: run the smoke test checklist above on each platform

## Actual Implementation

**Files created:**
- `tests/install.bats` — 8 BATS smoke tests (all skipped; require actual release binaries)

**Matrix configuration:** Already implemented in `release.yml` as part of section-01-ci-workflow.

**Local compile test result:** `bun build --compile --target=bun-linux-x64 src/index.ts` → 100MB binary, build succeeded in ~1.5s.

**Deviations from plan:**
- Tests use `run codesign -v "$bin"` + `[ "$status" -eq 0 ]` (vs bare `codesign -v`) for clearer BATS failure output.
- BINARY_DIR moved to `setup()` function per BATS scoping best practice.
- Added macOS x64 execution test (plan checklist was missing it; section text required all three).
- Added `[ -f "$bin" ] || skip "Binary not found: $bin"` guards for helpful skip messages.

**Tests: 8/8 skip** (all manual smoke tests requiring release binaries).