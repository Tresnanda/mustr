# Release QA gates

Per-release manual pass (SPEC §11). Run against a release build, not `tauri dev`.
Every gate must be green before tagging. Check items off in the release PR.

## 1. Keyboard-only pass

No trackpad/mouse. Complete each flow end to end:

- [ ] Launch → focus a pane → type into the terminal → switch panes/tabs/spaces
      with the bound shortcuts.
- [ ] ⌘K palette: open, search, execute an action, Escape closes and returns focus.
- [ ] Every dialog (settings, rename, close-pane, remote folder browser): Tab
      reaches every control, visible focus ring on each, Escape cancels,
      Enter/⌘Enter commits, focus returns to the trigger on close.
- [ ] Remote folder browser: arrows move the selection, Return descends, ⌘↑
      goes up, type-select jumps, ⇧⌘. toggles hidden folders.
- [ ] Sidebar: reach and activate New terminal, search, section fold, space rows,
      device pill, session switcher.

## 2. Reduced-motion pass

System Settings → Accessibility → Display → Reduce motion ON:

- [ ] Dialogs/menus/toasts cross-fade instead of sliding or scaling.
- [ ] No shake, shimmer, spring, or stagger anywhere (folder browser included).
- [ ] Status pulse and spinners: still convey state without vestibular motion.

## 3. Zoom & text pass

- [ ] macOS pointer zoom to 200%: all text legible, nothing clipped.
- [ ] Terminal text size at min and max settings: layout holds, no clipped chrome.
- [ ] Smallest window size (720×480): sidebar, tabs, and grid still usable;
      nothing overlaps or escapes.

## 4. Appearance pass

- [ ] Glass appearance over a busy wallpaper: terminal text stays legible.
- [ ] Solid appearance: no stray translucency.
- [ ] System "Reduce transparency" ON: surfaces go solid automatically.

## 5. Slow-motion animation review

Record the screen, play at 10% speed (or use the browser Animations panel in dev):

- [ ] Dialog enter/exit, menu pop, toast rise, tab/space drag, pane resize,
      folder-browser navigation: no double-fires, no jumps at interruption,
      exits softer than enters.
- [ ] Interrupt every animation mid-flight (close while opening, re-open while
      closing): motion retargets from the live value, never restarts from zero.

## 6. Disconnected / empty / error walkthrough

- [ ] Quit herdr while attached: panes show closed state, no spinner-forever;
      app reconnects when the server returns.
- [ ] Kill an SSH tunnel (sleep the remote or drop the network): reconnecting
      toast appears, sticky until restored; UI on other servers unaffected.
- [ ] Fresh machine simulation: no herdr installed → the install prompt renders,
      not a raw error.
- [ ] Empty states: no spaces, no agents, empty search results, empty folder in
      the remote browser — each orients and points forward.
- [ ] Remote folder browser: nonexistent path (shake + inline error), unreachable
      host (readable error, no hang).
- [ ] Updater: "Check for updates" with no release published → calm "up to date"
      or readable error, never a crash.

## 7. Release mechanics

- [ ] `pnpm tauri build` completes clean; app launches from the DMG.
- [ ] Version bumped in `tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`.
- [ ] CI green, including the protocol-pin job.
- [ ] Release notes state the herdr version / protocol compatibility range.
- [ ] After publishing: previous build's Settings → Check for updates finds and
      installs the new version, relaunch works.
