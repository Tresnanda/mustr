# Changelog

All notable changes to Mustr. Versions are semver; each release states its
herdr protocol compatibility.

## 0.2.1 — 2026-08-22

Compatible with **herdr 0.8.0 / protocol 19 and 0.8.2 / protocol 20**.

Agent-start sync fix (the mirror of 0.2.0's exit fix):
- A newly started agent now appears in the sidebar at once instead of after
  the ~15s drift reconcile (or a pane/tab switch). herdr recomputes a pane's
  agent classification lazily and doesn't push the set/cleared row to attach
  clients, so herdr-ui only learned of it on the next snapshot pull.
- Both boundaries are now caught from one signal: a mouse-capture transition
  that disagrees with the pane's current agent flag. Capture turning on while
  the pane isn't yet an agent means one likely just started (agents enable
  mouse reporting at startup); capture turning off while it still is means one
  likely just exited. Either way herdr-ui pulls a single rate-limited snapshot
  to sync the sidebar in under a second. Still event-driven, still no polling.

## 0.2.0 — 2026-08-22

Compatible with **herdr 0.8.0 / protocol 19 and 0.8.2 / protocol 20**.

Agent-exit sync fix:
- When an interactive agent (Claude Code, …) exits back to the shell, the
  pane now stops behaving like an agent immediately. herdr doesn't push the
  agent-cleared row to attach clients on exit, so the stale `agent` flag used
  to linger — the sidebar kept listing the pane as an agent, and clicks in the
  reverted shell were still forwarded as mouse reports, echoing raw SGR
  sequences (`\e[<b;c;rM`) back as visible garbage.
- Click forwarding now trusts the server's MouseCapture signal alone instead
  of falling back to the (lingering) agent flag, so a plain shell never
  receives synthetic mouse reports. The stale sidebar row clears in under a
  second: losing mouse capture while still flagged as an agent triggers one
  rate-limited snapshot, rather than waiting for the ~15s drift reconcile.
- No new timers or polling — the refresh is event-driven off the existing
  MouseCapture push and rate-limited, preserving the renderer/power budget.

## 0.1.6 — 2026-08-22

Compatible with **herdr 0.8.0 / protocol 19 and 0.8.2 / protocol 20**.

Renderer CPU/GPU footprint:
- The agent working-indicator no longer animates an SVG blur filter through
  the glass — that re-rasterized the backdrop every frame and pinned the
  WebKit GPU process (~17% per working agent). It's now a transform-only
  spinner driven by a CSS keyframe, which the compositor rotates for the
  same cost as a static dot: GPU process ~17% → ~3% while an agent works,
  with no loss of live feedback. (Drops the thinking-orbs dependency.)
- Terminals blink the cursor only on the focused pane, so idle panes stop
  repainting — and stop waking the GPU — closer to the ~0% idle bar in
  docs/perf-protocol.md.

Agent-status accuracy:
- Sub-second working↔idle flaps from herdr are coalesced (500ms settle), so
  the status-ordered agent list no longer thrashes its row order and the
  spinner no longer flashes for momentary blips.
- A pane left showing "working" after herdr dropped its resting-state push
  (attach clients don't receive every signal) now self-heals within ~20s
  via a cheap staleness check, instead of waiting for the 120s reconcile.
  The check is a no-op when the app is idle, so idle power is unchanged.

## 0.1.5 — 2026-08-21

Compatible with **herdr 0.8.0 / protocol 19 and 0.8.2 / protocol 20**.

- Idle resource usage fixed (issue #1): the frontend no longer polls.
  `pane.updated` events carry the full pane row and are merged directly;
  structural events re-seed from a snapshot; a 120s reconciliation pass
  replaces the old 15s poll. `api_request`/`git_summaries` moved off the
  main thread (`spawn_blocking`), and git summaries became a
  backend-owned cache pushed over FSEvents (`herdr-git`) instead of git
  subprocess spawns per refresh. Refreshes pause while the window is
  hidden; notifications keep working. Measured idle CPU drops from ~5%
  to ~0 (see docs/perf-protocol.md).
- Follow-up hardening on the above:
  - The git-watcher channel is published before the watch thread starts,
    so the first `git_summaries` call can't race registration and drop
    its watch set.
  - FS events are attributed to the changed repo(s) by path, so a change
    in one repo no longer re-runs `git` across every watched repo (with a
    full-sweep fallback for coalesced parent-dir events); an interleaved
    watch-set update during an event burst is no longer dropped.
  - Vanished repos (removed worktrees) are now pushed as removals over
    `herdr-git`, so a stale branch/dirty badge clears immediately.
  - Restoring a window that was hidden past the reconcile window re-seeds
    in full within one beat.

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
