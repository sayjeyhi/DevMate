Now I have all the information I need. Let me generate the complete, self-contained section content for section-07-readme.

# Section 07: README

## Overview

This section covers creating the `README.md` file at the repository root. The README is the primary documentation for the Jira Assistant Telegram bot tool, covering installation, usage, configuration, and build instructions.

**Dependencies:** Section 04 (install.sh core structure) must be complete before writing this README, since the install command, flags, and behavior must match what install.sh actually implements.

**No automated tests apply to this section.** A manual review checklist is used instead (see Tests section below).

---

## Tests (Manual Review Checklist)

Before marking this section done, verify the following in the final README:

- One-liner install command is prominent (at the top) and syntactically correct
- Security-conscious inspect-before-running alternative is present
- `JIRA_ASSISTANT_VERSION` env var pinning is documented with an example
- Requirements section covers OS support (macOS 12+, Linux x64 glibc only — not Alpine)
- Telegram command table is present with all commands
- Config file location and format are fully documented
- macOS Gatekeeper `xattr` workaround is documented under a "Manual Download" or "Gatekeeper" heading
- Manual build instructions specify Bun v1.3.11 (not latest)
- Uninstall command is present and correct
- Checksum limitation is honestly disclosed (no GPG, guards corruption only)
- `loginctl enable-linger` is documented with clear context (Linux boot-without-login, optional step)

---

## File to Create

**Path:** `/README.md` (repository root)

---

## README Structure and Content

### Section 1 — Install (at the top, most prominent)

The one-liner install command must appear at the top of the README. This is a `curl | bash` pattern. Directly below it, provide a security-conscious inspect-first alternative for users who prefer to review scripts before running.

One-liner:
```bash
curl -fsSL https://raw.githubusercontent.com/sayjeyhi/jira-assistant/main/install.sh | bash
```

Inspect-first alternative:
```bash
curl -fsSL https://raw.githubusercontent.com/sayjeyhi/jira-assistant/main/install.sh -o install.sh
less install.sh    # review before running
bash install.sh
```

Version pinning (optional, for reproducible installs):
```bash
JIRA_ASSISTANT_VERSION=v1.0.0 curl -fsSL https://raw.githubusercontent.com/sayjeyhi/jira-assistant/main/install.sh | bash
```

The `JIRA_ASSISTANT_VERSION` environment variable must be documented as a way to pin to a specific release tag, bypassing the "latest" redirect.

### Section 2 — Requirements

List the supported platforms and prerequisites:

- **macOS 12+** — arm64 (M-series) or x64 (Intel). Note: M-series Mac users running under Rosetta (`uname -m` returns `x86_64`) will get the x64 binary, which is functional but not optimal; run in a native arm64 shell for best performance.
- **Linux x64** — glibc-based distributions. Alpine Linux and other musl-based distributions are not supported; Bun binaries require glibc.
- **Not supported:** Linux ARM64, Windows (these rejection cases are enforced by install.sh with explicit error messages).
- **No runtime required** — the binary is self-contained (compiled with `bun --compile`).
- A Telegram bot token (obtain from @BotFather).
- A Jira Cloud API token.

### Section 3 — Available Telegram Commands

Include a table of all commands the bot responds to:

| Command | Description |
|---|---|
| `/create` | Create a new Jira issue |
| `/move` | Move an issue to a different status |
| `/comment` | Add a comment to an issue |
| `/solve` | Mark an issue as resolved |
| `/help` | List available commands |

### Section 4 — Config File

Document the canonical config file location and its full format.

**Location:** `~/.config/jira-assistant/config.json`

The install script runs a configuration wizard on first install (when stdin is a TTY). For non-interactive environments (e.g., piped `curl | bash`), the wizard is skipped and the user is prompted to run `jira-assistant config` to complete setup.

Show the full JSON structure with all required keys. The exact keys must reflect what the application actually reads (established in the `01-core-daemon` and `02-jira-integration` sections). Include placeholder values to show expected types.

Example:
```json
{
  "telegram": {
    "botToken": "YOUR_TELEGRAM_BOT_TOKEN"
  },
  "jira": {
    "baseUrl": "https://yourcompany.atlassian.net",
    "email": "you@example.com",
    "apiToken": "YOUR_JIRA_API_TOKEN",
    "projectKey": "PROJ"
  }
}
```

Note that the config file is created with `chmod 600` (user-read-only) by the install wizard.

### Section 5 — macOS Gatekeeper (Manual Downloads Only)

The install script strips the quarantine attribute automatically. This section is only relevant for users who download binaries manually from the GitHub Releases page.

For manual downloads:
```bash
xattr -d com.apple.quarantine /usr/local/bin/jira-assistant
```

Make it clear in the heading or an introductory sentence that this step is **not needed** when using the install script.

### Section 6 — Manual Build

For users who want to build from source. Requirements:

- Bun v1.3.11 (version must be pinned — do not use `latest`; v1.3.12 has a regression that produces invalid macOS ARM64 code signatures)

Build commands:
```bash
git clone https://github.com/sayjeyhi/jira-assistant.git
cd jira-assistant
bun install
# Build for your current platform:
bun build --compile src/index.ts --outfile jira-assistant
```

For cross-compilation targets, refer to the CI workflow matrix (darwin-arm64, darwin-x64, linux-x64) with the corresponding `--target=bun-<target>` flags.

### Section 7 — Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/sayjeyhi/jira-assistant/main/install.sh | bash -s -- --uninstall
```

Note that the uninstall command:
- Stops and removes the service (launchd on macOS, systemd on Linux)
- Removes the binary from `/usr/local/bin` or `~/.local/bin`
- Does **not** remove config files at `~/.config/jira-assistant/` — remove those manually if desired
- Does **not** clean up PATH entries added to shell RC files — remove those manually

### Section 8 — Checksum Note

The release includes a `checksums.txt` file. The install script downloads and verifies this automatically. This guards against accidental download corruption or truncation.

**Limitation:** Both the binary and `checksums.txt` are served from the same GitHub Release. A compromised release would serve both files, making this a corruption guard rather than a tamper-proof guarantee. Users who require stronger verification should build from source. GPG signing is out of scope for this tool.

### Section 9 — Linux Boot Without Login (`loginctl enable-linger`)

Document this as a clearly optional step for Linux users who want the bot to start at boot even when no user session is active.

```bash
loginctl enable-linger $USER
```

Context: By default, systemd user services only run while an active session exists. `loginctl enable-linger` removes this restriction. It may require sudo on some systems. The install script does not run this automatically — it only prints an advisory message.

---

## Writing Guidelines

- Use plain, direct language. Avoid marketing phrasing.
- Every code block must be copy-paste ready and correct.
- The macOS Gatekeeper and Rosetta notes should be clearly scoped (not buried in a wall of text).
- Do not reference internal implementation files or CI internals in user-facing sections.
- The README is for end users and contributors, not CI systems.

---

## Implementation Notes

- File created: `README.md` (143 lines)
- All 11 manual review checklist items confirmed present and correct
- Wizard skip condition clarified: "when no config exists AND stdin is a TTY; skipped on re-installs and non-interactive environments" (per code review)
- Section ordering: Install → Requirements → Commands → Config → Uninstall → Gatekeeper → loginctl → Checksum → Build (user-friendly, not strictly plan order)
- `src/index.ts` exists at repo root — build command is correct
- Replaced placeholder deep-trilogy plugin README that was at root