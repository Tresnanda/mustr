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
    /// Something under a watched git dir moved.
    Changed,
}

/// Called once at startup: spawns the watch thread.
pub fn init(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::spawn(watch_loop);
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

fn watch_loop() {
    let (tx, rx) = mpsc::channel::<Msg>();
    let _ = TRACK_TX.set(tx);

    let Ok(mut watcher) =
        notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            // Payload ignored; the sweep diffs real content instead.
            if let Some(tx) = TRACK_TX.get() {
                let _ = tx.send(Msg::Changed);
            }
        }
    }) else {
        return;
    };

    let mut watched: HashSet<String> = HashSet::new();
    let mut last_sweep = Instant::now() - SWEEP_FLOOR;

    while let Ok(msg) = rx.recv() {
        match msg {
            Msg::Track(desired) => {
                let desired: HashSet<String> = desired.into_iter().collect();
                for gone in watched.difference(&desired) {
                    if let Some(paths) = watch_paths(gone) {
                        for path in paths {
                            let _ = watcher.unwatch(&path);
                        }
                    }
                }
                for added in desired.difference(&watched) {
                    if let Some(paths) = watch_paths(added) {
                        for path in paths {
                            let mode = if path.is_dir() {
                                RecursiveMode::Recursive
                            } else {
                                RecursiveMode::NonRecursive
                            };
                            let _ = watcher.watch(&path, mode);
                        }
                    }
                }
                watched = desired;
            }
            Msg::Changed => {
                // Collapse bursts: wait out the floor, then drain any
                // queued Changed signals (Tracks stay queued).
                let elapsed = last_sweep.elapsed();
                if elapsed < SWEEP_FLOOR {
                    std::thread::sleep(SWEEP_FLOOR - elapsed);
                }
                while matches!(rx.try_recv(), Ok(Msg::Changed)) {}
                last_sweep = Instant::now();
                sweep(&watched);
            }
        }
    }
}

/// Re-summarize every watched cwd, push the changed ones to the UI.
fn sweep(watched: &HashSet<String>) {
    let mut delta = HashMap::new();
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
                        // Repo vanished (worktree removed, etc.) — stop
                        // advertising it; the next batch fetch cleans up.
                        cache.remove(cwd);
                    }
                }
            }
        }
    }
    if !delta.is_empty() {
        if let Some(app) = APP.get() {
            let _ = app.emit("herdr-git", json!({ "summaries": delta }));
        }
    }
}
