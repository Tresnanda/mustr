//! Server registry and active-connection switchboard.
//!
//! Every socket user (API requests, terminal attaches, the event stream)
//! resolves paths through `active_paths()`. Local is implicit; SSH remotes
//! ("quickies") are persisted to the app config dir and reached by
//! forwarding both herdr sockets over a system `ssh -N -L` child —
//! inheriting the user's ~/.ssh/config, keys, and agent.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
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
    pub active: bool,
}

struct Active {
    server_id: String,
    api_path: PathBuf,
    client_path: PathBuf,
    tunnel: Option<Child>,
}

static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);
/// Live event-stream socket, shut down on server switch so the blocking
/// reader wakes up and reconnects against the new paths.
pub static EVENT_STREAM: Mutex<Option<std::os::unix::net::UnixStream>> = Mutex::new(None);

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

/// Socket paths for the active server (Local when none was selected yet).
pub fn active_paths() -> (PathBuf, PathBuf) {
    let guard = ACTIVE.lock().unwrap();
    match guard.as_ref() {
        Some(a) => (a.api_path.clone(), a.client_path.clone()),
        None => (
            paths::api_socket_path(None).unwrap_or_default(),
            paths::client_socket_path(None).unwrap_or_default(),
        ),
    }
}

pub fn active_id() -> String {
    ACTIVE
        .lock()
        .unwrap()
        .as_ref()
        .map(|a| a.server_id.clone())
        .unwrap_or_else(|| "local".into())
}

pub fn list() -> Vec<ServerRow> {
    let active = active_id();
    let mut rows = vec![ServerRow {
        id: "local".into(),
        name: "Local".into(),
        detail: "This Mac · herdr.sock".into(),
        kind: "local".into(),
        active: active == "local",
    }];
    for r in load_remotes() {
        rows.push(ServerRow {
            id: r.id.clone(),
            name: r.name,
            detail: format!("{} · SSH", r.host),
            kind: "ssh".into(),
            active: active == r.id,
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
    if active_id() == id {
        switch_to_local()?;
    }
    Ok(list())
}

fn md5ish(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
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

fn interrupt_event_stream() {
    if let Some(stream) = EVENT_STREAM.lock().unwrap().take() {
        let _ = stream.shutdown(std::net::Shutdown::Both);
    }
}

fn install_active(active: Active) {
    let mut guard = ACTIVE.lock().unwrap();
    if let Some(old) = guard.take() {
        if let Some(mut tunnel) = old.tunnel {
            let _ = tunnel.kill();
            let _ = tunnel.wait();
        }
    }
    *guard = Some(active);
    drop(guard);
    interrupt_event_stream();
}

pub fn switch_to_local() -> Result<(), String> {
    let api = paths::api_socket_path(None).ok_or("no home dir")?;
    let client = paths::client_socket_path(None).ok_or("no home dir")?;

    if !ping_socket(&api) {
        // Auto-spawn a herdr server, mirroring herdr's own autodetect launch.
        Command::new("herdr")
            .arg("server")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    "herdr-not-installed".to_string()
                } else {
                    format!("could not start herdr: {e}")
                }
            })?;
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if ping_socket(&api) {
                break;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        if !ping_socket(&api) {
            return Err("herdr server did not come up within 15 seconds".into());
        }
    }

    install_active(Active {
        server_id: "local".into(),
        api_path: api,
        client_path: client,
        tunnel: None,
    });
    Ok(())
}

pub fn connect_remote(id: &str) -> Result<(), String> {
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
        .args(["-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"])
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
            install_active(Active {
                server_id: remote.id.clone(),
                api_path: l_api,
                client_path: l_client,
                tunnel: Some(tunnel),
            });
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

/// Watches the active SSH tunnel; when the ssh child dies (network drop,
/// laptop sleep), reports disconnected and retries the same remote once per
/// tick until it comes back.
pub fn spawn_supervisor(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let dead_remote = {
            let mut guard = ACTIVE.lock().unwrap();
            match guard.as_mut() {
                Some(active) => match active.tunnel.as_mut() {
                    Some(tunnel) => match tunnel.try_wait() {
                        Ok(Some(_)) => Some(active.server_id.clone()),
                        _ => None,
                    },
                    None => None,
                },
                None => None,
            }
        };
        if let Some(id) = dead_remote {
            let _ = app.emit("herdr-conn", json!({ "connected": false }));
            let _ = app.emit("herdr-tunnel", json!({ "status": "reconnecting", "id": id }));
            match connect_remote(&id) {
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
