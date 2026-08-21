# Changelog

All notable changes to Mustr. Versions are semver; each release states its
herdr protocol compatibility.

## 0.1.4 — 2026-08-21

Compatible with **herdr 0.8.0 / protocol 19 and 0.8.2 / protocol 20**.

- Mustr now speaks both herdr wire generations. The server's protocol is
  detected at connect (JSON `ping`) and each pane attaches using the matching
  vendored wire definitions, so upgrading herdr no longer breaks the app at
  the handshake — servers announcing an unsupported protocol get a clear
  error stating the supported range.
- CI now pins and hash-verifies both upstream wire sources
  (`wire19.rs` ← v0.8.0, `wire20.rs` ← v0.8.2).

## 0.1.3 — 2026-08-21

Compatible with **herdr 0.8.0 / protocol 19**.

- Clicks now work in agent panes: presses, drags, and releases forward to
  the pane as mouse reports (probe-verified end to end — a click lands on
  the exact cell). Scoped to panes running a detected agent, because
  herdr 0.8.x gives attach clients no way to know whether an arbitrary
  app is listening — a shell would render the bytes as garbage. Shift-click
  still selects text; a server-side mouse-state signal remains the
  upstream fix for every other TUI.

## 0.1.2 — 2026-08-21

Compatible with **herdr 0.8.0 / protocol 19**.

- Fixed for real: dragging a nested split no longer snaps back. The wire's
  split path is booleans, not "first"/"second" strings, so every nested
  resize was being rejected server-side. Splits now go down to the server's
  minimum (10%).
- Fixed: splitting a pane now splits *that* pane — the API parameter is
  `target_pane_id`, and the old `pane_id` was silently ignored, landing
  splits on whichever pane the server considered focused.
- The pointer now shows an arrow over panes running a detected agent and an
  I-beam over plain shells.
- Removed the 0.1.1 click-forwarding attempt: live-server probing showed
  herdr 0.8.x gives attach clients no safe channel for clicks (no mouse
  state signal, no attach-mouse message, raw bytes corrupt shell prompts).
  Clicking TUIs needs an upstream herdr addition; findings are documented
  in docs/protocol-notes.md. Wheel scrolling is unaffected (server-routed).

## 0.1.1 — 2026-08-21

Compatible with **herdr 0.8.0 / protocol 19**.

- Fixed: clicks now reach mouse-aware apps in panes (Claude Code's UI,
  htop, …) — mouse input is sent as the protocol's structured events
  instead of synthesized escape bytes — and the pointer shows an arrow
  instead of a text I-beam while the app owns the mouse.
- Fixed: split panes can now be dragged down to a compact strip (~80px);
  the old floor was 15% of the container, which snapped small terminal
  panes back to a third of a tall column.
- Fixed: closing a split's sibling no longer blanks or garbles the surviving
  pane — the terminal now adopts the server's pane size and honors full
  repaints.
- Fresh machines without herdr now see the "Herdr isn't installed" screen
  (with a Get herdr link) instead of a misleading "start herdr in a terminal"
  message; Check again now reports what it finds.
- One-line curl installer (`install.sh`) that sidesteps Gatekeeper's
  "damaged" dialog on the unsigned app.
- macOS bundles are now signed with a stable identity: browser-downloaded
  DMGs get the recoverable right-click → Open flow instead of "damaged",
  and macOS permissions survive updates.

## 0.1.0 — 2026-08-21

First public release. Compatible with **herdr 0.8.0 / protocol 19**.

- Mission control: spaces, tabs, and BSP pane grids in native macOS chrome,
  live from the herdr JSON API.
- Real terminals: per-pane xterm.js attach over the binary render protocol,
  with real mouse semantics and light/dark terminal themes.
- Agent awareness: live status in the sidebar (working / needs input / done /
  idle), filters, and native notifications on blocked/done.
- Multi-host: saved SSH devices with tunnel supervision and auto-reconnect,
  per-host windows, named local sessions.
- Remote folder browser for creating spaces on SSH hosts.
- Parity: worktrees, plugins, sessions, settings, ⌘K palette, keybinding
  remap, drag to resize/reorder/swap.
- In-app updates over GitHub Releases (signed updater artifacts).
