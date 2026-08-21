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

```sh
curl -fsSL https://raw.githubusercontent.com/Tresnanda/mustr/main/install.sh | sh
```

That's it — the script fetches the right build for your Mac, puts it in
/Applications, and opens it. Updates after that are delivered in-app
(Settings → Check for updates); update artifacts are cryptographically signed.

<details>
<summary>Installing from the DMG instead</summary>

You can also grab the `.dmg` from [Releases](https://github.com/Tresnanda/mustr/releases).
Builds are codesigned with a self-signed identity (**not** notarized), so macOS
still blocks a plain double-click of a browser download. On first launch,
right-click Mustr and choose **Open** (or approve it under System Settings →
Privacy & Security); after that it opens normally, and the stable signature
keeps permissions intact across in-app updates.

Releases older than this signing change shipped unsigned binaries — those hit
Gatekeeper's fatal "damaged" dialog instead, fixable with:

```sh
xattr -dr com.apple.quarantine /Applications/Mustr.app
```

The install script avoids all of this, which is why it's the recommended path.
</details>

### Requirements

- macOS 13+
- [herdr](https://github.com/herdrdev/herdr) installed locally (`brew install
  herdr` or see upstream docs). Mustr auto-starts a server if none is running.
  Any herdr speaking a supported wire protocol works (see Compatibility).
- For remote hosts: `ssh` access to a machine with a running herdr server.

### Compatibility

Mustr speaks a **range** of herdr wire protocol generations, vendored per
release: this build supports herdr **0.8.0 (protocol 19) and 0.8.2 (protocol
20)** — including any future herdr that still speaks one of those protocols.
The server's generation is detected at connect; unsupported protocol numbers
are rejected with a clear error rather than misread.

When upstream herdr ships a new protocol generation, Mustr must re-vendor the
wire definitions and cut a release before it can talk to it — check the
release notes for the supported range before upgrading either side.

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
