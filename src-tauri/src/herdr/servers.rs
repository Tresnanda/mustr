//! Server registry and connection pool.
//!
//! Any number of servers can be live at once — each window binds to one
//! server id and every socket user (API requests, terminal attaches, the
//! event streams) resolves paths through `paths_for(id)`. Local sessions
//! are implicit; SSH remotes ("quickies") are persisted to the app config
//! dir and reached by forwarding both herdr sockets over a system
//! `ssh -N -L` child — inheriting the user's ~/.ssh/config, keys, and
//! agent. One tunnel per remote, shared by every window on that remote.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::Emitter;

use super::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteServer {
    pub id: String,
    pub name: String,
    /// ssh destination: host alias from ~/.ssh/config or user@host.
    pub host: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerRow {
    pub id: String,
    pub name: String,
    pub detail: String,
    pub kind: String, // "local" | "ssh"
    /// A live pool entry exists (sockets reachable / tunnel up). Which
    /// server a given window is *on* is that window's own state.
    pub connected: bool,
}

struct Connection {
    api_path: PathBuf,
    client_path: PathBuf,
    tunnel: Option<Child>,
}

static POOL: OnceLock<Mutex<HashMap<String, Connection>>> = OnceLock::new();
/// Ids the user wants connected. Distinct from the pool: a supervisor
/// rebuild empties the pool entry for a moment, but intent survives, so
/// event streams know a gap from a deliberate disconnect.
static WANTED: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
/// Ids with a connect attempt in flight, so concurrent callers (a window
/// opening + a switch + the supervisor) can't race duplicate tunnels.
static CONNECTING: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
/// Live event-stream sockets by server id, shut down on disconnect so the
/// blocking readers wake up and exit (or reconnect against new paths).
static EVENT_STREAMS: OnceLock<Mutex<HashMap<String, std::os::unix::net::UnixStream>>> =
    OnceLock::new();

fn pool() -> &'static Mutex<HashMap<String, Connection>> {
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn wanted() -> &'static Mutex<std::collections::HashSet<String>> {
    WANTED.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

pub fn is_wanted(id: &str) -> bool {
    wanted().lock().unwrap().contains(id)
}

fn connecting() -> &'static Mutex<std::collections::HashSet<String>> {
    CONNECTING.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

fn streams() -> &'static Mutex<HashMap<String, std::os::unix::net::UnixStream>> {
    EVENT_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn config_file() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let dir = PathBuf::from(home)
        .join("Library/Application Support/dev.mustr.app");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("servers.json"))
}

pub fn load_remotes() -> Vec<RemoteServer> {
    config_file()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_remotes(remotes: &[RemoteServer]) -> Result<(), String> {
    let path = config_file().ok_or("no config dir")?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(remotes).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn local_session_of(id: &str) -> Option<Option<&str>> {
    if id == "local" {
        Some(None)
    } else {
        id.strip_prefix("local:").map(Some)
    }
}

/// Socket paths for one server. Local ids resolve even before `connect`
/// so a fresh window can reach an already-running server immediately;
/// remotes must have a live pool entry (tunnel).
pub fn paths_for(id: &str) -> Result<(PathBuf, PathBuf), String> {
    if let Some(c) = pool().lock().unwrap().get(id) {
        return Ok((c.api_path.clone(), c.client_path.clone()));
    }
    if let Some(session) = local_session_of(id) {
        return Ok((
            paths::api_socket_path(session).ok_or("no home dir")?,
            paths::client_socket_path(session).ok_or("no home dir")?,
        ));
    }
    Err(format!("device '{id}' is not connected"))
}

pub fn is_connected(id: &str) -> bool {
    pool().lock().unwrap().contains_key(id)
}

pub fn list() -> Vec<ServerRow> {
    let mut rows = vec![ServerRow {
        id: "local".into(),
        name: "Local".into(),
        detail: "This Mac · herdr.sock".into(),
        kind: "local".into(),
        connected: is_connected("local"),
    }];
    // Named herdr sessions on this Mac: each is its own server + sockets.
    if let Some(home) = std::env::var_os("HOME") {
        let sessions = PathBuf::from(home).join(".config/herdr/sessions");
        if let Ok(entries) = std::fs::read_dir(sessions) {
            let mut names: Vec<String> = entries
                .flatten()
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect();
            names.sort();
            for name in names {
                let id = format!("local:{name}");
                rows.push(ServerRow {
                    id: id.clone(),
                    name: name.clone(),
                    detail: format!("This Mac · session {name}"),
                    kind: "local".into(),
                    connected: is_connected(&id),
                });
            }
        }
    }
    for r in load_remotes() {
        rows.push(ServerRow {
            id: r.id.clone(),
            name: r.name,
            detail: format!("{} · SSH", r.host),
            kind: "ssh".into(),
            connected: is_connected(&r.id),
        });
    }
    rows
}

pub fn add(name: String, host: String) -> Result<Vec<ServerRow>, String> {
    let name = name.trim().to_owned();
    let host = host.trim().to_owned();
    if name.is_empty() || host.is_empty() {
        return Err("name and host are required".into());
    }
    let mut remotes = load_remotes();
    let id = format!("ssh-{:x}", md5ish(&format!("{name}|{host}")));
    if remotes.iter().any(|r| r.id == id) {
        return Err("that device is already saved".into());
    }
    remotes.push(RemoteServer { id, name, host });
    save_remotes(&remotes)?;
    Ok(list())
}

pub fn remove(id: &str) -> Result<Vec<ServerRow>, String> {
    let mut remotes = load_remotes();
    remotes.retain(|r| r.id != id);
    save_remotes(&remotes)?;
    disconnect(id);
    Ok(list())
}

fn md5ish(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

/// Resolve the herdr executable's real path.
///
/// A macOS `.app` launched from Finder/Dock does NOT inherit the user's shell
/// PATH — launchd hands it only `/usr/bin:/bin:/usr/sbin:/sbin` plus whatever
/// `/etc/paths.d` adds (Homebrew). herdr installs to `~/.local/bin`, which is
/// on none of those, so a bare `Command::new("herdr")` PATH lookup fails with
/// `NotFound` even though herdr is installed — and that reads to the UI as
/// "not installed". Resolve the path ourselves instead of trusting PATH:
/// explicit override, then the well-known install locations, then a login
/// shell's own `command -v` (which sees wherever the user actually put it).
fn resolve_herdr_bin() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("HERDR_BIN") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(&home).join(".local/bin/herdr"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/herdr"));
    candidates.push(PathBuf::from("/usr/local/bin/herdr"));
    candidates.push(PathBuf::from("/usr/bin/herdr"));
    if let Some(hit) = candidates.into_iter().find(|c| c.is_file()) {
        return Some(hit);
    }
    // Last resort: ask a login shell, which sources the user's profile and so
    // knows the same PATH their terminal does.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let out = Command::new(shell)
        .args(["-lc", "command -v herdr"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    let path = PathBuf::from(path);
    path.is_file().then_some(path)
}

fn ping_socket(path: &PathBuf) -> bool {
    let Ok(mut stream) = std::os::unix::net::UnixStream::connect(path) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    if stream
        .write_all(b"{\"id\":\"probe\",\"method\":\"ping\",\"params\":{}}\n")
        .is_err()
    {
        return false;
    }
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).is_ok() && line.contains("pong")
}

pub fn register_event_stream(id: &str, stream: std::os::unix::net::UnixStream) {
    streams().lock().unwrap().insert(id.to_owned(), stream);
}

fn interrupt_event_stream(id: &str) {
    if let Some(stream) = streams().lock().unwrap().remove(id) {
        let _ = stream.shutdown(std::net::Shutdown::Both);
    }
}

/// Ensure a live connection for `id`; no-op when already pooled. Never
/// touches other connections — windows on other servers stay live.
pub fn connect(id: &str) -> Result<(), String> {
    if is_connected(id) {
        return Ok(());
    }
    if !connecting().lock().unwrap().insert(id.to_owned()) {
        // Another caller is already connecting this id: wait for it.
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(200));
            if !connecting().lock().unwrap().contains(id) {
                return if is_connected(id) {
                    Ok(())
                } else {
                    Err("could not connect".into())
                };
            }
        }
        return Err("connection attempt timed out".into());
    }
    let result = match local_session_of(id) {
        Some(session) => connect_local(session),
        None => connect_remote(id),
    };
    connecting().lock().unwrap().remove(id);
    if result.is_ok() {
        wanted().lock().unwrap().insert(id.to_owned());
    }
    result
}

/// Drop one connection: kill its tunnel and wake its event stream. Any
/// window still bound to this id reports disconnected until it switches.
pub fn disconnect(id: &str) {
    wanted().lock().unwrap().remove(id);
    if let Some(mut conn) = pool().lock().unwrap().remove(id) {
        if let Some(tunnel) = conn.tunnel.as_mut() {
            let _ = tunnel.kill();
            let _ = tunnel.wait();
        }
    }
    interrupt_event_stream(id);
}

fn connect_local(session: Option<&str>) -> Result<(), String> {
    let api = paths::api_socket_path(session).ok_or("no home dir")?;
    let client = paths::client_socket_path(session).ok_or("no home dir")?;

    if !ping_socket(&api) {
        // Server isn't up. Resolve the binary before deciding it's missing:
        // an unresolvable path is the only true "not installed", whereas a
        // resolved binary that won't come up is a start failure — two states
        // the UI must not conflate (one says "install herdr", the other
        // "herdr is installed but its server didn't start").
        let bin = resolve_herdr_bin().ok_or("herdr-not-installed")?;
        // Auto-spawn a herdr server, mirroring herdr's own autodetect launch.
        let mut cmd = Command::new(&bin);
        if let Some(name) = session {
            cmd.env("HERDR_SESSION", name);
        }
        cmd.arg("server")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not start herdr: {e}"))?;
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if ping_socket(&api) {
                break;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        if !ping_socket(&api) {
            return Err("herdr-server-no-start".into());
        }
    }

    let id = match session {
        Some(name) => format!("local:{name}"),
        None => "local".into(),
    };
    pool().lock().unwrap().insert(
        id,
        Connection {
            api_path: api,
            client_path: client,
            tunnel: None,
        },
    );
    Ok(())
}

fn connect_remote(id: &str) -> Result<(), String> {
    let remote = load_remotes()
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("unknown device")?;

    // Resolve the remote HOME (streamlocal forwarding needs absolute paths).
    let out = Command::new("ssh")
        .args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", &remote.host])
        .arg("printf %s \"$HOME\"")
        .output()
        .map_err(|e| format!("ssh not available: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "SSH to {} failed: {}",
            remote.host,
            err.lines().last().unwrap_or("connection refused")
        ));
    }
    let home = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    if home.is_empty() {
        return Err("could not resolve the remote home directory".into());
    }

    let local_dir = std::env::temp_dir().join(format!("mustr-{}", remote.id));
    let _ = std::fs::remove_dir_all(&local_dir);
    std::fs::create_dir_all(&local_dir).map_err(|e| e.to_string())?;
    let l_api = local_dir.join("herdr.sock");
    let l_client = local_dir.join("herdr-client.sock");

    let tunnel = Command::new("ssh")
        .args(["-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes"])
        // Bypass connection multiplexing for the tunnel: under
        // ControlMaster the -N child hands its forwards to the mux master
        // and exits 0 immediately, which reads as a dead tunnel to the
        // supervisor and flaps the connection forever. A direct child
        // lives exactly as long as its forwards, so liveness is honest.
        .args(["-o", "ControlMaster=no", "-o", "ControlPath=none"])
        .args(["-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"])
        // ANSI terminal frames compress extremely well; on a WAN link this
        // is the difference between sluggish and instant full repaints.
        .args(["-o", "Compression=yes"])
        .arg("-L")
        .arg(format!("{}:{home}/.config/herdr/herdr.sock", l_api.display()))
        .arg("-L")
        .arg(format!(
            "{}:{home}/.config/herdr/herdr-client.sock",
            l_client.display()
        ))
        .arg(&remote.host)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start ssh: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if ping_socket(&l_api) {
            pool().lock().unwrap().insert(
                remote.id.clone(),
                Connection {
                    api_path: l_api,
                    client_path: l_client,
                    tunnel: Some(tunnel),
                },
            );
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    let mut tunnel = tunnel;
    let _ = tunnel.kill();
    Err(format!(
        "connected to {}, but no herdr server answered there — start one with `herdr` on that machine",
        remote.host
    ))
}

/// Host aliases from ~/.ssh/config (wildcard and negated patterns skipped).
pub fn ssh_aliases() -> Vec<String> {
    let Some(home) = std::env::var_os("HOME") else {
        return Vec::new();
    };
    let path = PathBuf::from(home).join(".ssh/config");
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        let Some(rest) = line
            .strip_prefix("Host ")
            .or_else(|| line.strip_prefix("host "))
        else {
            continue;
        };
        for pattern in rest.split_whitespace() {
            if pattern.contains(['*', '?']) || pattern.starts_with('!') {
                continue;
            }
            if !out.contains(&pattern.to_string()) {
                out.push(pattern.to_string());
            }
        }
    }
    out
}

/// Watches every remote the user wants connected. When its ssh child dies
/// (network drop, laptop sleep) — or an earlier reconnect failed and the
/// pool entry is missing — reports that server disconnected and retries
/// once per tick until it comes back or the user disconnects it.
pub fn spawn_supervisor(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let remotes: Vec<String> = wanted()
            .lock()
            .unwrap()
            .iter()
            .filter(|id| !id.starts_with("local"))
            .cloned()
            .collect();
        for id in remotes {
            let dead = {
                let mut guard = pool().lock().unwrap();
                match guard.get_mut(&id) {
                    Some(conn) => match conn.tunnel.as_mut() {
                        Some(tunnel) => matches!(tunnel.try_wait(), Ok(Some(_))),
                        None => false,
                    },
                    // Wanted but not pooled: an earlier retry failed.
                    None => true,
                }
            };
            if !dead {
                continue;
            }
            // Drop the dead entry so connect() rebuilds the tunnel, but
            // leave the event stream to reconnect on its own backoff.
            if let Some(mut conn) = pool().lock().unwrap().remove(&id) {
                if let Some(tunnel) = conn.tunnel.as_mut() {
                    let _ = tunnel.kill();
                    let _ = tunnel.wait();
                }
            }
            let _ = app.emit("herdr-conn", json!({ "server": id, "connected": false }));
            let _ = app.emit("herdr-tunnel", json!({ "status": "reconnecting", "id": id }));
            match connect(&id) {
                Ok(()) => {
                    let _ = app.emit("herdr-tunnel", json!({ "status": "restored", "id": id }));
                }
                Err(err) => {
                    let _ = app.emit(
                        "herdr-tunnel",
                        json!({ "status": "down", "id": id, "error": err }),
                    );
                }
            }
        }
    });
}
