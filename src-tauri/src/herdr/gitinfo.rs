//! Local git summaries for sidebar rows: branch + dirty.
//! Only meaningful for the Local server — remote cwds are on the remote.
//!
//! Backend-owned cache (issue #1): `summaries` returns cached values,
//! computing only unknown cwds, and registers an FSEvents watch on each
//! tracked cwd's git metadata (`HEAD`, `index`, branch refs). When the
//! filesystem actually changes, the affected cwd is re-summarized and the
//! delta is pushed to the frontend as `herdr-git`. Nothing polls; idle
//! cost is kernel-level event delivery only.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc;
use std::sync::{LazyLock, OnceLock};
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GitSummary {
    pub branch: String,
    pub dirty: bool,
}

/// One re-summarize sweep per watched set per this interval, no matter
/// how the FS event bursts. Our own `git status` runs can touch the index
/// and re-trigger events; the content diff below makes that converge
/// instead of looping.
const SWEEP_FLOOR: Duration = Duration::from_millis(500);

static CACHE: LazyLock<Mutex<HashMap<String, GitSummary>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Runtime input (the AppHandle), set once at startup.
static APP: OnceLock<AppHandle> = OnceLock::new();
/// The watch loop's inbox; its receiver lives inside the thread.
static TRACK_TX: OnceLock<mpsc::Sender<Msg>> = OnceLock::new();

enum Msg {
    /// Frontend declared this as the full set of interesting cwds.
    Track(Vec<String>),
    /// Something under a watched git dir moved; carries the changed paths
    /// so a sweep can re-summarize only the affected repo(s).
    Changed(Vec<PathBuf>),
}

/// Called once at startup: spawns the watch thread. The channel sender is
/// published *before* the thread starts so the very first `summaries()`
/// call can't race watcher registration and silently drop its `Track`.
pub fn init(app: AppHandle) {
    let _ = APP.set(app);
    let (tx, rx) = mpsc::channel::<Msg>();
    let _ = TRACK_TX.set(tx);
    std::thread::spawn(move || watch_loop(rx));
}

/// Cached summaries for `cwds`; unknown cwds are summarized once. Also
/// syncs the watch set — the frontend calls this whenever the set of
/// pane cwds changes, never on a timer.
pub fn summaries(cwds: Vec<String>) -> HashMap<String, GitSummary> {
    let mut out = HashMap::new();
    let mut missing = Vec::new();
    {
        let cache = CACHE.lock();
        for cwd in &cwds {
            match cache.get(cwd) {
                Some(summary) => {
                    out.insert(cwd.clone(), summary.clone());
                }
                None => missing.push(cwd.clone()),
            }
        }
    }
    if !missing.is_empty() {
        let mut computed = HashMap::new();
        for cwd in &missing {
            if let Some(summary) = summarize(cwd) {
                computed.insert(cwd.clone(), summary);
            }
        }
        CACHE.lock().extend(computed.clone());
        out.extend(computed);
    }
    if let Some(tx) = TRACK_TX.get() {
        let _ = tx.send(Msg::Track(cwds));
    }
    out
}

/// Branch + dirty via two short git invocations. None = not a repo.
fn summarize(cwd: &str) -> Option<GitSummary> {
    let branch = Command::new("git")
        .args(["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned());
    let Some(branch) = branch.filter(|b| !b.is_empty()) else {
        return None;
    };
    let dirty = Command::new("git")
        .args(["-C", cwd, "status", "--porcelain", "--untracked-files=no"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);
    Some(GitSummary { branch, dirty })
}

/// Paths whose movement means the summary could have changed: the
/// worktree's HEAD + index, plus shared branch refs (commits move tips
/// without touching HEAD; packed-refs lives at the common root).
fn watch_paths(cwd: &str) -> Option<Vec<PathBuf>> {
    let abs = |args: &[&str]| -> Option<PathBuf> {
        let out = Command::new("git")
            .args(["-C", cwd])
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        (!s.is_empty()).then_some(PathBuf::from(s))
    };
    let git_dir = abs(&["rev-parse", "--absolute-git-dir"])?;
    let common = abs(&["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .unwrap_or_else(|| git_dir.clone());
    Some(vec![
        git_dir.join("HEAD"),
        git_dir.join("index"),
        common.join("refs/heads"),
        common.join("packed-refs"),
    ])
}

fn watch_loop(rx: mpsc::Receiver<Msg>) {
    let Ok(mut watcher) =
        notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if let Some(tx) = TRACK_TX.get() {
                let _ = tx.send(Msg::Changed(event.paths));
            }
        }
    }) else {
        return;
    };

    // cwd -> the paths we actually registered for it, so an FS event can be
    // attributed back to the affected repo(s) instead of re-summarizing the
    // whole watched set on every event.
    let mut watched: HashMap<String, Vec<PathBuf>> = HashMap::new();
    let mut last_sweep = Instant::now() - SWEEP_FLOOR;

    while let Ok(msg) = rx.recv() {
        match msg {
            Msg::Track(desired) => apply_track(&mut watcher, &mut watched, desired),
            Msg::Changed(paths) => {
                // Collapse bursts: wait out the floor, then drain queued
                // messages — folding Changed paths together and applying any
                // interleaved Track immediately so it isn't lost.
                let mut changed = paths;
                let elapsed = last_sweep.elapsed();
                if elapsed < SWEEP_FLOOR {
                    std::thread::sleep(SWEEP_FLOOR - elapsed);
                }
                loop {
                    match rx.try_recv() {
                        Ok(Msg::Changed(more)) => changed.extend(more),
                        Ok(Msg::Track(desired)) => {
                            apply_track(&mut watcher, &mut watched, desired)
                        }
                        Err(_) => break,
                    }
                }
                last_sweep = Instant::now();
                sweep(&affected_cwds(&watched, &changed));
            }
        }
    }
}

/// Sync the watch set to `desired`: unwatch dropped repos, watch new ones,
/// remembering which paths registered so events can be attributed later.
fn apply_track<W: Watcher>(
    watcher: &mut W,
    watched: &mut HashMap<String, Vec<PathBuf>>,
    desired: Vec<String>,
) {
    let desired: HashSet<String> = desired.into_iter().collect();
    let gone: Vec<String> = watched
        .keys()
        .filter(|c| !desired.contains(*c))
        .cloned()
        .collect();
    for cwd in gone {
        if let Some(paths) = watched.remove(&cwd) {
            for path in paths {
                let _ = watcher.unwatch(&path);
            }
        }
    }
    for cwd in &desired {
        if watched.contains_key(cwd) {
            continue;
        }
        // Non-repos get an empty entry so we don't re-run git for them on
        // every Track; the sweep's content diff is the source of truth.
        let registered = watch_paths(cwd)
            .map(|paths| {
                paths
                    .into_iter()
                    .filter(|path| {
                        let mode = if path.is_dir() {
                            RecursiveMode::Recursive
                        } else {
                            RecursiveMode::NonRecursive
                        };
                        watcher.watch(path, mode).is_ok()
                    })
                    .collect()
            })
            .unwrap_or_default();
        watched.insert(cwd.clone(), registered);
    }
}

/// Which watched cwds a burst of changed paths touches. Matching is done in
/// both directions so a parent-dir coalesced event still resolves. Falls
/// back to the whole set when nothing matches, so a coalesced or unexpected
/// event never causes a missed change.
fn affected_cwds(
    watched: &HashMap<String, Vec<PathBuf>>,
    changed: &[PathBuf],
) -> HashSet<String> {
    let mut affected = HashSet::new();
    for (cwd, paths) in watched {
        if paths
            .iter()
            .any(|wp| changed.iter().any(|c| c.starts_with(wp) || wp.starts_with(c)))
        {
            affected.insert(cwd.clone());
        }
    }
    if affected.is_empty() {
        return watched.keys().cloned().collect();
    }
    affected
}

/// Re-summarize every watched cwd, push the changed ones to the UI.
fn sweep(watched: &HashSet<String>) {
    let mut delta = HashMap::new();
    let mut removed: Vec<String> = Vec::new();
    {
        let mut cache = CACHE.lock();
        for cwd in watched {
            let fresh = summarize(cwd);
            if cache.get(cwd) != fresh.as_ref() {
                match fresh {
                    Some(summary) => {
                        cache.insert(cwd.clone(), summary.clone());
                        delta.insert(cwd.clone(), summary);
                    }
                    None => {
                        // Repo vanished (worktree removed, etc.) — drop it
                        // and tell the UI so it stops showing a stale badge.
                        cache.remove(cwd);
                        removed.push(cwd.clone());
                    }
                }
            }
        }
    }
    if delta.is_empty() && removed.is_empty() {
        return;
    }
    if let Some(app) = APP.get() {
        let _ = app.emit("herdr-git", json!({ "summaries": delta, "removed": removed }));
    }
}
