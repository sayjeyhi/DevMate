# Release Checklist

Run these manually before publishing each release.

- [ ] **macOS arm64 binary** — `./devmate-macos-arm64 --version`; exit code must not be 137 (SIGKILL = code-signature regression)
- [ ] **macOS x64 binary** — `./devmate-macos-x64 --version`; clean exit
- [ ] **Linux x64 binary** — `./devmate-linux-x64 --version`; clean exit
- [ ] **Binary sizes** — each binary between 10 MB and 500 MB (smaller = likely corrupt download or HTML error page)
- [ ] **macOS codesign** — `codesign -v devmate-macos-arm64` exits 0 (ad-hoc signature present)
- [ ] **curl pipe install on macOS** — one-liner install completes; Gatekeeper does not block execution
- [ ] **curl pipe install on Linux x64** — systemd service starts; `systemctl --user status devmate` shows active
- [ ] **Restart behavior on Linux** — `systemctl --user kill devmate`; service restarts within 5 seconds (RestartSec)
- [ ] **`--uninstall` after clean install** — binary and service files gone; `~/.config/devmate/` preserved
- [ ] **Re-install over existing install** — no errors; service stops, binary replaced, service restarts
- [ ] **`~/.local/bin` fallback** — as non-root or with `/usr/local/bin` read-only, install uses `~/.local/bin` and PATH update fires
- [ ] **Checksum mismatch** — corrupt a downloaded binary byte; "Checksum mismatch" message and exit 1
- [ ] **Non-TTY stdin** — `curl ... | bash`; config wizard deferred; advisory message printed
- [ ] **Linux ARM64 rejection** — on ARM64 Linux, explicit error message and exit 1
- [ ] **Version pinning** — `DEV_MATE_VERSION=v1.0.0 bash install.sh`; exact version downloaded
