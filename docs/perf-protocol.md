# Idle-resource protocol (issue #1)

Mustr is a companion app: near-zero CPU/RAM/power when idle, instant when
watched. This file is the re-measurable recipe — run it before any release
that touches the event loop, IPC, or the sidebar data path. Baselines live
in the PR that changed them.

## 1. Idle CPU (host + renderer)

App open, no agents running, nothing typed for ~60s:

```sh
M=$(pgrep -x mustr | head -1)   # host process
top -pid $M -l 12 -stats cpu,mem,power 2>/dev/null | tail -15
# renderer: find the WebContent child of $M in Activity Monitor or:
ps -o pid,pcpu,rss,comm -ax | grep -i webcontent
```

Acceptance: host ≤ 0.5% avg, renderer ≈ 0%.

## 2. No periodic git spawns while idle

```sh
sudo fs_usage -w -f exec | grep -v grep | grep --line-buffered ' git'
```

Leave idle 5 min. Expect zero `git` execs after the initial batch
(they only run when the pane-cwd set changes or the watcher fires).

## 3. No blocking socket I/O on the main thread

While an agent is actively producing output (worst-case event churn):

```sh
sample <host_pid> 10 -file /tmp/mustr.sample
grep -c "did_receive" /tmp/mustr.sample   # context lines only
grep -c "herdr::api::request" /tmp/mustr.sample  # must be 0 busy samples
```

`api_request` runs on `spawn_blocking`; main-thread frames inside
`wry_web_view_delegate::did_receive → api_request` are a regression.

## 4. Energy Impact

Activity Monitor → Energy tab, after 10 min idle: Mustr should read 0–1
and never appear under "Apps Using Significant Energy". Screenshot goes in
the release/PR description.

## 5. Behavior matrix (manual)

- [ ] Agent flips working → blocked/done while window hidden → notification fires
- [ ] Structural actions (new tab, split, close, rename, focus) update UI instantly
- [ ] Sidebar dirty-badge updates when a watched repo changes on disk
      (external edit — validates the FSEvents watcher push)
- [ ] Remote server window still refreshes over the SSH tunnel
- [ ] `herdr server stop` + restart → window reconnects and re-seeds
- [ ] Minimize for >2 min → restore → state correct within one beat
      (120s reconciliation + visibility flush)

## Renderer memory

Record footprint alongside RSS (`footprint` CLI or Activity Monitor's
Memory column; RSS overstates). Target set in issue #1 follow-ups; fix
only what a sample of the WebContent process actually indicts.
