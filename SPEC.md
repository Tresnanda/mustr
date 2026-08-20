# Mustr — Product & Engineering Spec

> **Mustr** (v. *to muster* — gather the herd): a native desktop client for [herdr](https://github.com/herdrdev/herdr), the terminal runtime for AI coding agents.
> Mission control for your agents: a live status sidebar, native notifications when an agent blocks, real terminals, and one-click attach to any herdr server — local or remote.

Status: pre-scaffold. This document is the reference for all product, architecture, and design decisions. Decisions here were made deliberately (see §14 Decision Log); don't re-litigate them casually.

---

## 1. Product definition

### 1.1 What Mustr is

A **third-party GUI client** for the herdr server. Herdr already runs as a headless background daemon that owns PTYs, sessions, agent-state detection, and persistence, exposing two local sockets. Mustr is a new kind of client attached to those sockets — it renders herdr's world natively and never reimplements the runtime.

**Compatibility is the prime directive:** Mustr must work against any stock herdr server (v0.8+, protocol-gated). We never fork herdr, never require patches to it, never fight the TUI or CLI clients — all clients coexist on one server.

### 1.2 What Mustr is not

- Not a fork or reimplementation of herdr.
- Not a general-purpose terminal emulator (panes exist inside herdr's workspace model).
- Not a wrapper that embeds the TUI in a window. Every surface is real GUI chrome.

### 1.3 Why it should exist (the three headline wins over the TUI)

1. **Native notifications with click-to-focus.** "Claude is blocked and needs an answer" as a real macOS/Windows notification that focuses the exact pane when clicked. The #1 reason a desktop app beats a terminal tab.
2. **Glanceable mission control.** A real sidebar with agent-state badges, git status, and workspace rollups — visible even when the window is small or docked.
3. **One-click remote attach ("quickies").** Saved servers (local + SSH remotes); click → tunneled → attached. No `herdr --remote user@host` incantations.

---

## 2. Herdr integration contract

### 2.1 The two sockets (verified against herdr v0.8.2 source)

| Socket | Path (default session) | Protocol | Mustr's use |
| --- | --- | --- | --- |
| **JSON API** | `~/.config/herdr/herdr.sock` | Newline-delimited JSON req/resp + subscriptions. ~100 methods. Published JSON Schema (`docs/next/api/herdr-api.schema.json`). | Entire control plane: workspaces, tabs, panes, agents, worktrees, plugins, layout ops, event stream. |
| **Render/input** | `~/.config/herdr/herdr-client.sock` | Length-prefixed (u32 LE) **bincode**, `PROTOCOL_VERSION = 20`, max frame 2 MB (32 MB graphics). | Per-pane terminal streams only. |

Named sessions live under `~/.config/herdr/sessions/<name>/`; Windows uses named pipes under `%APPDATA%\herdr\`.

### 2.2 Terminal attachment model (the core trick)

Mustr opens **one render-socket connection per visible pane**:

1. `Hello { version, cols, rows, requested_encoding: TerminalAnsi, launch_mode: TerminalAttach, ... }`
2. Server replies `Welcome { version, encoding, error }` — a version mismatch is a clean, user-facing "update herdr / update Mustr" state, never garbled output.
3. Switch the connection with `ControlTerminal { target, takeover }` (writable) or `ObserveTerminal { target }` (read-only). Targets accept pane/terminal/agent ids.
4. Server streams `ServerMessage::Terminal(TerminalFrame { seq, width, height, full, bytes })` — pre-diffed raw ANSI, written verbatim into the pane's xterm.js instance.
5. Input goes back as `ClientMessage::Input { data }` (raw bytes from xterm.js `onData`); scroll as `AttachScroll`; size changes as `Resize`.

Consequences:
- **No VT emulation in Mustr.** xterm.js is the emulator; herdr's vendored libghostty already parsed everything server-side.
- Only *visible* panes hold render connections. Offscreen panes are known via the JSON API; connections are opened lazily on reveal and closed on hide (small LRU keep-warm cache to make tab switches instant).
- `Notify`, `Clipboard` (OSC 52), `WindowTitle`, `TerminalBell`, and `MouseCapture` server messages are handled in the Rust core and surfaced natively.

### 2.3 Control plane

- Long-lived JSON API connection per server with `events.subscribe` for: `workspace.*`, `tab.*`, `pane.*` (incl. `agent_status_changed`, `output_matched`), `worktree.*`, `layout.updated`.
- Every UI action maps to exactly one API method (`pane.split`, `pane.close`, `pane.zoom`, `layout.set_split_ratio`, `tab.create`, `workspace.focus`, `agent.prompt`, …). The frontend never mutates state locally-first except where §8 marks an optimistic update.
- Agent states from the API: `working | blocked | done | idle | unknown`. These five states drive the entire status system (§7.4).
- Compatibility gate: `ping` → `Pong { version, protocol, capabilities }` on connect. Unknown-newer servers degrade gracefully; unsupported ones get a clear explanation screen.

### 2.4 Protocol types strategy

- **JSON API:** generate TypeScript + Rust types from herdr's published JSON Schema. Regeneration is a build step pinned to a herdr release tag.
- **Binary protocol:** vendor-copy `src/protocol/wire.rs` (plus minimal type deps) into the Rust core, pinned to protocol v20, Apache-2.0 attribution preserved. A `just sync-protocol` script diffs our copy against the pinned upstream tag; protocol bumps are deliberate, reviewed upgrades.
- File a friendly upstream issue proposing an official `herdr-protocol` crate; delete our copy if it lands.
- Never hand-port bincode structs — field order is wire format.

### 2.5 Server lifecycle (manage, don't bundle)

On launch / on selecting the local server:
1. Probe the client socket. Answering server → attach.
2. No server, herdr installed (PATH, brew prefix, known locations) → spawn `herdr server` detached, poll socket readiness (mirror upstream: 15 s timeout, 50 ms interval), attach.
3. Herdr not installed → guided install screen (runs the official install script, or downloads the release binary) — one click, progress shown, never silent.

Mustr never bundles a herdr binary, never manages herdr self-updates (herdr's live-handoff replaces the server without killing PTYs — Mustr just reconnects both sockets and resubscribes).

### 2.6 Remote servers ("quickies")

- Transport: **system `ssh` child process** with unix-socket forwarding: forward both remote sockets to local temp sockets, then treat the server as local. Inherits `~/.ssh/config`, keys, agent, ProxyJump, hardware keys. Windows 10+ ships OpenSSH.
- Saved connections: name, host (or ssh-config alias), herdr session name, color/emoji tag. Stored in Mustr's config (never credentials — auth is SSH's job).
- Connect flow: click → spawn tunnel → probe → attach. Auth prompts (passphrase, host-key trust) are surfaced through a pty-wrapped ssh so Mustr renders them as native dialogs. v1 supports key/agent auth cleanly; exotic auth is best-effort.
- Liveness: tunnel supervisor with exponential-backoff reconnect; connection state is always visible in the UI (§7.2), never silently stale.

---

## 3. Tech stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Shell | **Tauri 2** | Rust core + system webview. macOS (WKWebView) first, Windows (WebView2) trailing. |
| Rust core | tokio, vendored `wire.rs`, `interprocess` (or `tokio::net::UnixStream` + named pipes), serde/serde_json, bincode 2 | Owns sockets, SSH tunnels, server lifecycle, config, notifications. |
| Frontend | **React 19 + Vite + TypeScript** | Strict mode. |
| Styling | **Tailwind v4** | Design tokens as CSS variables (§7), OKLCH colors. |
| Terminal | **@xterm/xterm + WebGL addon** | + fit, web-links addons. Canvas fallback if WebGL unavailable. |
| State | **Zustand** | Normalized mirror of server state, fed by the event bridge. |
| Animation | **Motion** (motion/react) | Springs for gesture-driven motion; CSS transitions for state changes. See §8. |
| Icons | **Phosphor** (`@phosphor-icons/react`) | One library, one weight per surface. **lucide-react is banned.** |
| Primitives | shadcn/ui structure (Radix under the hood) for dialogs, menus, popovers, forms | Restyled to Mustr tokens. Pattern references: amicro, transitions.dev, beui, Metal, Beam (reimplemented, not copied, unless licensed). |
| Package manager | **pnpm 11**, exact pins, `save-exact=true`, postinstall scripts blocked by default (allowlist via `pnpm.onlyBuiltDependencies`) | Per global dependency policy. |

**Data flow:**

```
herdr server ──herdr.sock (JSON)──► Rust core ──Tauri channel──► Zustand ──► React chrome
herdr server ──herdr-client.sock──► Rust core ──per-pane Tauri channel──► xterm.js pane
React chrome ──invoke("api", method, params)──► Rust core ──► herdr.sock
xterm.js onData ──channel──► Rust core ──► pane's render connection
```

The Rust core is the only process that speaks herdr. The frontend is a pure view + command dispatcher.

---

## 4. Application architecture

### 4.1 Rust core modules

| Module | Responsibility |
| --- | --- |
| `server_registry` | Known servers (local + quickies), connection state machine per server, persistence of saved connections. |
| `lifecycle` | Local server detect/spawn/install (§2.5). |
| `tunnel` | SSH child processes, socket forwarding, reconnect supervisor, auth-prompt pty bridge. |
| `api_client` | JSON API connection, request/response correlation, `events.subscribe` pump → normalized events on a Tauri channel. |
| `term_client` | Per-pane render connections: handshake, `TerminalFrame` → pane channel, input/resize/scroll upstream, keep-warm LRU. |
| `protocol` | Vendored `wire.rs` (pinned, attributed) + framing codec. |
| `notify` | `Notify`/agent-state → OS notifications (tauri-plugin-notification), click → focus routing. |
| `config` | Mustr settings (JSON in app-config dir): quickies, appearance, notification prefs, keybindings. |

### 4.2 Frontend structure

```
src/
  app/            shell, routing (single window, no router needed beyond view state)
  state/          zustand stores: servers, workspaces, panes, agents, ui
  bridge/         typed Tauri invoke/channel wrappers (generated API types)
  components/
    sidebar/      workspace list, agent rows, status badges, git info
    panes/        BSP layout renderer, pane frame, terminal host, split handles
    tabs/         tab bar
    terminal/     xterm.js wrapper (lifecycle, addons, theme sync, resize observer)
    servers/      server switcher, quickies manager, connect dialogs
    command/      ⌘K navigator
    dialogs/      rename, confirm-close, worktree, settings, install-herdr
    feedback/     toasts, connection banners, empty states
  design/         tokens.css, motion.ts (shared easing/duration constants)
```

### 4.3 Layout rendering

Herdr's layout is a BSP tree (`layout.export` gives it; `layout.updated` events keep it fresh). Mustr renders it as nested flex containers with drag handles on split borders. Drag → local preview (transform only) → `layout.set_split_ratio` on release. Zoom (`pane.zoom`) renders the zoomed pane full-bleed with the tree remembered underneath.

---

## 5. Feature spec (v1)

v1 target: **full herdr parity + desktop-native extras.** Staged only where §5.4 says so.

### 5.1 Core surfaces

- **Sidebar** — workspaces (collapsible), each with agent rows: agent icon, pane title, state badge, time-in-state; workspace rollup badge (worst state wins: blocked > working > done > idle); git branch + dirty indicator. Click row → focus pane. Drag to reorder (`workspace.move`).
- **Tab bar** — per-workspace tabs; create/rename/close/reorder; middle-click close; overflow menu.
- **Pane grid** — BSP render, focus ring on active pane, split (right/down), close with confirm when a process would die, zoom toggle, drag-resize borders, drag-and-drop pane swap (`pane.swap`).
- **Terminals** — xterm.js per pane; native scrollback via `AttachScroll`; selection & copy handled by xterm.js; paste (incl. image paste → `ClipboardImage`); ⌘F find-in-scrollback (xterm search addon); per-pane bell indicator.
- **Server switcher + quickies** — top-level server list; local server auto-managed; add/edit/remove saved remotes; per-server connection status; import hosts from `~/.ssh/config`.
- **Command palette (⌘K)** — jump to workspace/tab/pane/agent, run commands (split, new tab, attach server). Replaces TUI navigator + global launcher.
- **Notifications** — agent → blocked / done, `Notify{SystemToast}`, terminal bell (configurable). Click focuses the exact pane. Per-workspace mute. In-app toast mirror for when the window is focused.
- **Worktrees** — list/create/open/remove via dialogs over `worktree.*`.
- **Plugins** — installed list, enable/disable, invoke plugin actions, view plugin logs (`plugin.*`). Marketplace browsing links out to herdr.dev/plugins in v1.
- **Settings** — appearance (theme, font family/size for terminals), notifications, keybindings (Mustr's own shortcuts), servers, herdr binary path override.
- **Sessions** — herdr named-session switcher per server.

### 5.2 Desktop-native behaviors

- macOS: native menu bar with full command set; dock badge = count of blocked agents; window restoration.
- Global shortcut (configurable, default off) to summon Mustr.
- OS theme sync (light/dark) with manual override; terminal theme follows app theme.
- Single-instance app; second launch focuses the window.

### 5.3 Keyboard model

Mustr uses **desktop-app shortcuts, not tmux prefix chords** (⌘T new tab, ⌘W close pane w/ confirm, ⌘D / ⌘⇧D split, ⌘1–9 tabs, ⌘K palette, ⌘⌥←→ workspace switch). All remappable. A pane's terminal owns all keys while focused except registered app shortcuts; an explicit "pass-through mode" (per-pane toggle) sends *everything* to the terminal for agents that need conflicting chords.

### 5.4 Staged (not blocking v1 release)

- Kitty graphics edge cases (large transfers, acks, retirement). Common path (inline images render) ships in v1.
- Windows polish (notifications, window chrome niceties) trails macOS by design.
- Plugin marketplace browsing in-app.
- Exotic SSH auth flows beyond key/agent + passphrase prompts.

---

## 6. Non-goals (v1)

- Mobile / web builds.
- Managing herdr's own config (`config.toml`) beyond what Settings explicitly covers.
- Multi-window (one window; maybe pane pop-out later).
- Telemetry of any kind.

---

## 7. Design system

The design language is defined by the mandated skill set (Apple fluid-interface principles, Emil Kowalski's design-engineering doctrine, motion-design timing, the better-* craft rules, design-foundations). Where they conflict, the more restrained rule wins. This section is binding.

### 7.1 Design stance

Mustr is a **professional monitoring/workspace tool**. Personality: **Corporate-calm with premium restraint** — crisp, fast, quiet. Delight comes from responsiveness and correctness compounding, not from decoration. One primary action per view; hierarchy by subtraction, not louder elements.

### 7.2 Color

- **All colors in OKLCH**, defined as semantic tokens (`--surface-1..3`, `--border-subtle`, `--text-primary/secondary/muted`, `--accent`, plus the status set below). No raw hex in components.
- **Dark-first, light fully supported.** Terminals are the emotional center of the app and they're dark; the chrome is designed around them. Dark mode is *not* inverted light: topmost surfaces are the lightest dark greys; brand/status colors desaturated 20–30% vs light mode.
- Borders: dark mode uses solid near-blacks (alpha-white glows); light mode uses `oklch(0 0 0 / 0.08)`-style alpha borders (solid hexes sit on top). Elevation via layered shadows (2–3 stacked, varying blur/alpha), never one big drop shadow.
- Neutrals carry a slight cool hue bias (never pure grey), agreeing with the accent.
- **Status colors are sacred and never reused for anything else:**

| State | Hue intent | Redundant cue (never color alone) |
| --- | --- | --- |
| `working` | animated-capable neutral/blue | pulsing dot (static dot under reduced motion) + label |
| `blocked` | amber/orange — the attention state | filled badge + icon + label; strongest visual weight in the sidebar |
| `done` | green | check icon + label |
| `idle` | muted neutral | hollow dot + label |
| `unknown` | grey | dashed/question cue + label |

- The accent color is *not* green and *not* the blocked-amber (no collision with status semantics).
- Contrast: measure rendered pairs; body text ≥ WCAG AA. Terminal theme palettes shipped with verified contrast on both app themes.

### 7.3 Typography

- **UI:** system stack (`font: -apple-system/system-ui`) — platform-tuned, zero load cost, optical sizing built in. **Terminals + inline code/ids:** one bundled monospace (woff2, only used weights), with a metric-matched fallback stack.
- Type scale (semantic names, not sizes): `text-display` (rare) / `text-title` (panel headers) / `text-body` (14px UI default) / `text-label` (13px) / `text-micro` (12px, floor; weight 500+ at this size). Long-form (docs, install screens) at 16px, measure capped ~65ch.
- Line-height: 1.1–1.2 titles, 1.5 body, ≥1.4 anything wrapping 3+ lines. Letter-spacing: slightly negative on titles, `+0.02em` on the few uppercase micro-labels, 0 elsewhere.
- `tabular-nums` on **everything that ticks**: durations ("blocked 4m 12s"), counters, port numbers, dock badge mirrors.
- `antialiased` once at the root. Truncation always leaves the full value reachable (tooltip or expand). Sentence case everywhere (§7.6).

### 7.4 The status system (signature element)

The agent-state badge is Mustr's identity — the one element allowed a persistent ambient animation, and it must be perfect:

- `working`: dot with a slow opacity pulse (~2s sine ease-in-out loop, subtle range e.g. 0.5→1; **never** a spinner — work is ongoing, not loading). Static filled dot under `prefers-reduced-motion`.
- `blocked`: **no oscillating animation** (a permanent throb is an alarm you learn to ignore). It enters with a single spring pop (scale 0.8→1, ~300ms) + notification, then holds steady at maximum visual weight. Time-in-state counts up beside it in tabular nums.
- State *transitions* cross-fade with a subtle scale (0.9→1, 150ms ease-out). Never layout-shift the row.
- Workspace rollups aggregate with the same grammar at smaller size.

### 7.5 Layout

- Grouping by space, not lines: intra-group gap → inter-group gap ≥ 2×. Separators only where space can't carry it (sidebar/content boundary).
- Spacing on a 4px system via parent `gap`, never per-child margins. Nested radii concentric: inner = outer − padding.
- Logical properties (`padding-inline-start` etc.) throughout — free RTL correctness.
- Sidebar: resizable (persisted), collapsible to an icon rail with rollup badges. Content bleeds; controls respect layout margins.
- Min window ~720×480 must remain fully functional (sidebar auto-collapses).
- Every surface designed in all states: default / hover / focus / active / loading / empty / error / disconnected. **Empty states point forward** ("No agents running — open a terminal and start one, or split a pane"), **disconnected states explain and offer the action** ("Connection to build-box lost. Reconnecting… · Retry now").

### 7.6 Writing

- One voice: calm, plain, technical-neutral. Sentence case for every button, label, heading, menu item.
- Verb-first buttons naming the outcome: "Attach", "Split right", "Create worktree", "Delete quickie" (destructive confirms repeat the consequence — never Yes/No/OK).
- Errors = instruction + location: "Unable to attach. The herdr server didn't respond — check that it's running on build-box." Never "Oops", never exclamation marks in errors, no blame, no "we're having trouble".
- Herdr's vocabulary is law: *workspace, tab, pane, agent, session, worktree* mean what herdr means. Mustr adds only *server* and *quickie*.
- No fragment-concatenated strings; full templates with pluralization.

### 7.7 Motion

Motion doctrine: **feedback, not decoration.** Frequency test first — anything triggered dozens of times per session doesn't animate.

**Tokens** (single source in `design/motion.ts` + CSS vars):

```
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1)     /* enters, reveals */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)    /* on-screen movement */
--dur-fast:    120ms   /* hover, press, focus */
--dur-base:    200ms   /* dropdowns, popovers, state cross-fades */
--dur-slow:    300ms   /* dialogs, panels — the ceiling for UI motion */
spring-default: { type: "spring", duration: 0.4, bounce: 0 }
spring-pop:     { type: "spring", duration: 0.3, bounce: 0.15 }  /* blocked-badge entrance only */
```

**Rules:**
- **Never animate:** tab switching, pane focus moves, ⌘K open/close, any keyboard-initiated navigation. Instant.
- **Standard animation:** dialogs (scale 0.96 + fade, origin-aware for anchored popovers, centered for modals), toasts (slide+fade from edge, exit same path, exit ~25% faster), sidebar collapse (translate/opacity, not width where avoidable).
- Transform + opacity only; CSS transitions for interruptible interactive states; keyframes only for run-once sequences; springs only for gesture-driven motion (pane border drag release, drag-reorder settle) with velocity handoff from the pointer.
- Press feedback `scale(0.97)` on primary pressable chrome (not on high-frequency controls), transition 120ms ease-out, respond on pointer-down.
- Split-border drag: 1:1 pointer tracking with grab-offset respected, rubber-band past min-pane-size, spring settle on release.
- Sidebar list changes: enters fade+4px rise, ≤40ms stagger only on bulk appearance (initial subscribe), `initial={false}` everywhere else — no entrance replay on window refocus.
- `prefers-reduced-motion`: all movement replaced with ≤150ms opacity fades; working-pulse becomes static; springs disabled.
- No custom animation inside terminal content ever — xterm.js output is sacred.

### 7.8 Accessibility (floor, not feature)

- Keyboard-complete: every flow finishes without a mouse. `:focus-visible` rings (2px, offset, token color) on all interactive chrome; never `outline: none` bare.
- Native elements first; ARIA only where composite widgets require APG patterns (sidebar tree, tab bar with roving tabindex, palette listbox).
- Dialogs: focus trap, `inert` background, Escape closes, focus returns to trigger.
- Terminal panes are focusable regions with accessible names ("Terminal — claude, working, workspace herdr-ui"); status changes announced via a polite live region (stable region, text swap); blocked → `role="alert"` only if the user enabled it (avoids alert fatigue).
- Hit areas ≥ 24×24 minimum, 40×40 target on desktop chrome; expanded via pseudo-elements without overlap.
- All status information triple-encoded: color + icon/shape + text (§7.2, §7.4).
- Zoom to 200% must not break the chrome layer; terminal font size independently adjustable (⌘+/−).

---

## 8. State, performance & correctness rules

- **Server state is truth.** The Zustand mirror is rebuilt from `workspace.list`/`layout.export` + events on every (re)connect; events are versioned by receipt order per server. On subscription gap/reconnect: full resync, no diff guessing.
- **Optimistic updates** only for: split-ratio drag preview, sidebar reorder preview, focus highlight. Everything else waits for the API response/event (round-trip is local-socket fast).
- Terminal writes go straight from the Tauri channel to `term.write()` — never through React state. Frame data never enters Zustand.
- Backpressure: if a pane's channel lags (window hidden, huge output), request a full repaint on resume rather than replaying the backlog (`TerminalFrame.full` supports this).
- 60fps budget on chrome interactions; transform/opacity only; no layout-thrash observers (one shared ResizeObserver for pane sizing).
- Every list that can grow unbounded (panes, quickies, plugin logs) is virtualized or capped with disclosure.
- Reconnect storms are rate-limited with jittered backoff; UI always distinguishes "reconnecting" from "detached by user".

---

## 9. Security & privacy

- No telemetry, no network calls except: user-initiated herdr install/download, user-initiated SSH tunnels, Tauri updater manifest check.
- SSH credentials never stored — delegated entirely to the user's SSH setup. Quickie config contains hostnames/aliases only.
- Local sockets are 0600 (herdr's doing); Mustr never widens permissions, never proxies a herdr socket onto TCP.
- Tauri: strict CSP, no remote content in the webview, IPC allowlist scoped to the bridge commands only.
- Dependency policy per global rules: exact pins, install scripts blocked/allowlisted, socket.dev check before adding any dependency, `pnpm audit signatures` in CI.

---

## 10. Distribution

- Public GitHub repo. GitHub Releases as the update backend, **Tauri updater** wired from the first tagged build (signed update manifests — updater keys ≠ Apple signing).
- macOS: unsigned for now (documented right-click-open / `xattr` instructions in README); Apple Developer notarization deferred until the project earns the $99.
- Windows: unsigned, SmartScreen warning accepted for now.
- Versioning: semver; changelog per release; protocol/API compatibility range stated in every release's notes.

---

## 11. Testing strategy

- **Rust core:** integration tests that spawn a real `herdr server` (same approach as upstream's test suite) — handshake, encoding negotiation, pane attach, input round-trip, reconnect, version-mismatch rejection.
- **Protocol pinning:** a CI check that fails if the pinned herdr tag's `wire.rs` differs from our vendored copy (forces conscious upgrades).
- **Frontend:** component tests for the status grammar and layout renderer; Playwright (or tauri-driver) smoke: launch → auto-spawn server → open pane → type → see echo.
- **Design QA gates per release:** keyboard-only pass, reduced-motion pass, 200% zoom pass, both themes, slow-motion animation review (10% speed), disconnected/empty/error state walkthrough.

---

## 12. Milestones

| # | Milestone | Definition of done |
| --- | --- | --- |
| M0 ✅ | **Walking skeleton** | Tauri app connects to local herdr, one xterm.js pane attached via `TerminalAnsi`, typing round-trips. Riskiest plumbing proven. |
| M1 ✅ | **Mission control** | Sidebar + tabs + BSP grid live from JSON API events; focus/split/close/zoom; native notifications on `blocked`/`done`. |
| M2 | **Servers** | Local lifecycle management (detect/spawn/install), quickies with SSH tunneling, reconnect supervision. |
| M3 | **Parity** | Worktrees, plugins, sessions, settings, ⌘K palette, keybinding remap, drag interactions (resize/reorder/swap). |
| M4 | **Polish & ship** | Design QA gates green, updater wired, docs/README, first public release (macOS), Windows build following. |

---

## 13. Open questions (tracked, not blocking)

1. ~~Does attach deliver scrollback history?~~ **Answered (M0):** attach immediately sends a full-repaint `TerminalFrame` of the current viewport; scrollback stays server-side via `AttachScroll`. See `docs/protocol-notes.md`.
2. Exact semantics of `takeover` when the TUI holds the writable attach — verify multi-client behavior against a live server.
3. Whether per-pane connections scale to ~20 visible panes on one unix socket path, or a shared-connection multiplex is needed (measure in M1).
4. Upstream appetite for a `herdr-protocol` crate (file the issue during M1).
5. **Note (M0):** installed herdr is 0.8.0 / protocol 19 — the vendored `wire.rs` is pinned to the v0.8.0 tag, not 0.8.2/v20 (wire-incompatible: v20 shifted enum indices). Re-vendor on herdr update.

---

## 14. Decision log

| Decision | Choice | Why |
| --- | --- | --- |
| Client vs fork | Client on stock herdr | Compatibility with existing servers; runtime is herdr's job |
| Integration depth | Native chrome + per-pane terminal attach | "Its own application", not TUI-in-a-window |
| Shell | Tauri 2 over GPUI | Stable on Windows, Rust where the protocol lives, web where design leverage lives |
| Terminal rendering | xterm.js fed `TerminalAnsi` per-pane | Verified in herdr source; zero VT work; mature emulator |
| Server lifecycle | Manage, don't bundle | Avoid version-skew fights with brew/CLI installs; herdr self-updates itself |
| Remote transport | System `ssh` + socket forwarding | Inherits the user's entire SSH world |
| Protocol types | Vendor `wire.rs` pinned @ v20 + schema codegen | Bincode is field-order-exact; hand-porting is unsafe |
| Scope | Full parity in v1, graphics edge cases + Windows polish staged | Capability isn't the constraint; protocol risk is |
| Name | **Mustr** | Herding word, herdr-style vowel drop |
| Distribution | Public repo, GH Releases + Tauri updater, unsigned for now | $99 deferred |
