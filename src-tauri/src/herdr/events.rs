//! Persistent event subscriptions: one long-lived JSON API connection per
//! connected server, streaming herdr events to every window as tagged
//! `herdr-event` emissions (`{ server, event }`), plus a `herdr-conn`
//! emission (`{ server, connected }`) whenever that server's connection
//! state changes. Windows filter by the server id they are bound to.
//! Reconnects with backoff; the frontend re-syncs its state mirror on
//! every (re)connect.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};


#[cfg(unix)]
type Stream = std::os::unix::net::UnixStream;

/// Broad topics verified against herdr 0.8.0 (see docs/protocol-notes.md).
/// `pane.updated` carries agent_status, so no scoped subscription is needed.
const TOPICS: &[&str] = &[
    "pane.created",
    "pane.closed",
    "pane.updated",
    "pane.focused",
    "workspace.created",
    "workspace.renamed",
    "workspace.closed",
    "workspace.focused",
    "tab.created",
    "tab.closed",
    "tab.focused",
    "layout.updated",
];

static RUNNING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn running() -> &'static Mutex<HashSet<String>> {
    RUNNING.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Start the event-stream thread for one server if it isn't running yet.
/// Local streams live for the whole process; remote streams exit once the
/// server leaves the pool (disconnect shuts the socket to wake them).
pub fn ensure_stream(app: AppHandle, server_id: String) {
    if !running().lock().unwrap().insert(server_id.clone()) {
        return;
    }
    std::thread::spawn(move || {
        let ephemeral = !matches!(server_id.as_str(), s if s == "local" || s.starts_with("local:"));
        let mut backoff = Duration::from_millis(500);
        loop {
            match run_once(&app, &server_id) {
                Ok(()) => backoff = Duration::from_millis(500),
                Err(_) => {}
            }
            let _ = app.emit(
                "herdr-conn",
                json!({ "server": server_id, "connected": false }),
            );
            if ephemeral && !super::servers::is_wanted(&server_id) {
                break;
            }
            std::thread::sleep(backoff);
            backoff = (backoff * 2).min(Duration::from_secs(10));
        }
        running().lock().unwrap().remove(&server_id);
    });
}

fn run_once(app: &AppHandle, server_id: &str) -> Result<(), String> {
    let (path, _) = super::servers::paths_for(server_id)?;
    let mut stream = Stream::connect(&path).map_err(|e| e.to_string())?;
    // Register so a disconnect can shut this stream down and wake us.
    if let Ok(clone) = stream.try_clone() {
        super::servers::register_event_stream(server_id, clone);
    }

    let subscriptions: Vec<Value> = TOPICS.iter().map(|t| json!({ "type": t })).collect();
    let req = json!({
        "id": "mustr:events",
        "method": "events.subscribe",
        "params": { "subscriptions": subscriptions },
    });
    let mut line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
    line.push('\n');
    stream.write_all(line.as_bytes()).map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(stream);
    let mut ack = String::new();
    reader.read_line(&mut ack).map_err(|e| e.to_string())?;
    let ack: Value = serde_json::from_str(&ack).map_err(|e| e.to_string())?;
    if ack.get("error").is_some() {
        return Err(format!("subscribe rejected: {ack}"));
    }

    let _ = app.emit("herdr-conn", json!({ "server": server_id, "connected": true }));

    for event_line in reader.lines() {
        let event_line = event_line.map_err(|e| e.to_string())?;
        if event_line.is_empty() {
            continue;
        }
        if let Ok(event) = serde_json::from_str::<Value>(&event_line) {
            let _ = app.emit("herdr-event", json!({ "server": server_id, "event": event }));
        }
    }
    Ok(())
}
