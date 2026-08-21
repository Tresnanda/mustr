# Herdr protocol — empirical notes (verified against herdr 0.8.0, protocol 19)

Findings from live testing that the docs/schema don't make obvious. Keep this
updated whenever behavior is verified against a real server.

## JSON API (`herdr.sock`)

- `params` is **required** on every request, even empty: `{"id":"x","method":"ping","params":{}}`.
  Omitting it returns `invalid_request: missing field 'params'`.
- **One connection per request** is the reliable pattern (the CLI does the same).
  A second request on the same connection hit a broken pipe in testing.
- `ping` → `{type:"pong", version:"0.8.0", protocol:19, capabilities:{live_handoff, detached_server_daemon}}`.
- `pane.list` → `result.panes[]`: `pane_id` ("w1Z:p1"), `terminal_id`, `workspace_id`,
  `tab_id`, `focused`, `cwd`, `foreground_cwd`, `terminal_title`, `terminal_title_stripped`,
  `agent`, `agent_status` (working|blocked|done|idle|unknown), `scroll{offset_from_bottom,...}`.
- `workspace.list` → `result.workspaces[]`: `workspace_id`, `label`, `number`, `focused`,
  `agent_status` (rollup), `pane_count`, `tab_count`, `active_tab_id`.
- `pane.read` params: `{pane_id, source}` where source ∈ `visible | recent | recent_unwrapped | ...`
  (not `lines`/`target`). `source:"visible"` returns the current screen text.
- `api snapshot` (CLI) / `session.snapshot` returns everything in one shot:
  agents, panes, tabs, workspaces, layouts (BSP with splits+ratios+rects) — ideal M1 seed.

## Render socket (`herdr-client.sock`, protocol 19)

- Framing: u32 LE length prefix + bincode 2 `config::standard()` (varint ints,
  enum variant index as varint).
- Handshake: `Hello{version:19, cols, rows, cell_w:0, cell_h:0, TerminalAnsi, Server, TerminalAttach}`
  → `Welcome{version:19, encoding:TerminalAnsi, error:None}` (raw: `00 13 01 00`).
- `ControlTerminal{target:"<pane_id>", takeover:true}` accepts pane ids like `"w10:p1"`.
- **Attach immediately delivers a full-repaint `TerminalFrame`** (`full:true`) of the
  current viewport, starting with `ESC[?2026h` (synchronized update). No history
  backfill needed for first paint. Scrollback is server-side via `AttachScroll`.
- `ClientMessage::Input{data}` with raw bytes (e.g. `"echo hi\r"`) round-trips —
  verified by reading the result back through `pane.read`.
- 0.8.0 vs 0.8.2 wire is **incompatible** (v20 inserted `ClientLaunchMode::AppDirectGraphics`,
  shifting bincode variant indices; 0.8.2 also added `TerminalBell` etc.).
  Vendored `wire.rs` must match the server generation — currently pinned to v0.8.0 tag.

## Version-skew plan

`Welcome.error` carries a clean rejection message on mismatch, and JSON `ping.protocol`
tells us the server's protocol before attaching. When herdr updates past 0.8.0,
re-vendor `wire.rs` from the matching tag and bump the pin note in the file header.

## How `herdr --remote` transports (from source, v0.8.0 `src/remote/unix.rs`)

Read while chasing remote lag parity. herdr does **not** use `ssh -L` socket
forwarding:

- It bridges over **SSH command stdio**: a local Unix socket is served by a
  bridge that, per connection, spawns `ssh -T <target> "herdr --remote-client-bridge"`;
  the remote end pipes stdio ↔ the remote `herdr-client.sock`.
- It manages its **own ssh multiplexing** (`-S <own control path>`,
  `ControlMaster=auto`, `ControlPersist=yes`, own `-F` config), so those
  per-connection ssh execs are ~1-RTT channel opens.
- The thin client holds **one persistent binary-protocol connection** for the
  whole UI — server-pushed frames, no JSON API polling in the interactive path.

Confirmed in `src/api/server.rs`: `handle_connection` reads a single request
line, responds, and returns — the JSON API is one-request-per-connection **by
design** (only `events.subscribe` and `wait` stream). Caching/reusing API
connections is therefore pointless; the remote-latency lever is fewer requests
and overlapped requests, plus `Compression=yes` on our tunnel.

Mustr's tunnel deliberately opts **out** of the user's ControlMaster
(`ControlMaster=no ControlPath=none`): under muxing an `ssh -N -L` child hands
its forwards to the master and exits 0 immediately, which breaks
child-process-liveness supervision (see servers.rs).
