# Mustr

**Mustr** (v. *to muster* — gather the herd) is a native macOS desktop client for
[herdr](https://github.com/herdrdev/herdr), the terminal runtime for AI coding agents.
It turns your herdr sessions — local and remote — into a mission-control app: spaces,
tabs, and BSP pane grids in native chrome, live agent status in the sidebar, and
real terminals attached pane-by-pane.

## What it does

- **Mission control** — sidebar of spaces and agents with live status (working /
  needs input / done / idle), native notifications when an agent blocks or finishes.
- **Real terminals** — every pane is an xterm.js terminal attached over herdr's
  binary render protocol; typing, scrollback, and mouse semantics round-trip.
- **Multi-host** — connect to herdr on other machines over plain SSH (your
  `~/.ssh/config`, keys, and agent are inherited; nothing to install remotely
  beyond herdr itself). Each host can have its own window.
- **Parity with the TUI** — worktrees, sessions, plugins, ⌘K palette, keybinding
  remap, drag to resize/reorder/swap, and a remote folder browser for creating
  spaces on SSH hosts.

## Install

Download the latest `.dmg` from [Releases](https://github.com/Tresnanda/mustr/releases).

The app is currently **unsigned** (no Apple Developer account yet), so macOS will
quarantine it on first launch. Either right-click the app → **Open** → **Open**, or:

```sh
xattr -dr com.apple.quarantine /Applications/Mustr.app
```

Updates after that are delivered in-app (Settings → Check for updates); update
artifacts are cryptographically signed, so the updater itself is safe despite the
unsigned first install.

### Requirements

- macOS 13+
- [herdr](https://github.com/herdrdev/herdr) installed locally (`brew install herdr`
  or see upstream docs). Mustr auto-starts a server if none is running.
- For remote hosts: `ssh` access to a machine with a running herdr server.

### Compatibility

Mustr pins herdr's wire protocol per release. This build speaks **protocol 19**
(herdr **0.8.0**). Newer herdr versions with a different protocol number are
rejected at connect rather than misread — check the release notes for the
supported range before upgrading herdr.

## Development

```sh
pnpm install
pnpm tauri dev     # kill any stale vite on port 1420 first
```

- Frontend: React + TypeScript + Tailwind v4 (Vite), zustand state, Radix primitives.
- Shell: Tauri 2 (Rust). The herdr protocol types are vendored in
  `src-tauri/src/protocol/wire.rs`, pinned to the herdr tag above — bincode is
  field-order-exact, so re-vendor consciously on herdr upgrades (CI fails if the
  vendored copy drifts from the pinned tag).
- Empirical protocol notes live in [`docs/protocol-notes.md`](docs/protocol-notes.md).
- The full product spec is [`SPEC.md`](SPEC.md).

### Release

Tag `v*` and push: CI builds the macOS bundles, signs the updater artifacts, and
drafts a GitHub Release with `latest.json` for the in-app updater.

## License

TBD.
