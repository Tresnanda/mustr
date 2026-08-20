//! Persistent event subscription: one long-lived JSON API connection that
//! streams herdr events to the frontend as `herdr-event` emissions, plus a
//! `herdr-conn` emission whenever connection state changes. Reconnects with
//! backoff; the frontend re-syncs its state mirror on every (re)connect.

use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::paths;

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

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut backoff = Duration::from_millis(500);
        loop {
            match run_once(&app) {
                Ok(()) => backoff = Duration::from_millis(500),
                Err(_) => {}
            }
            let _ = app.emit("herdr-conn", json!({ "connected": false }));
            std::thread::sleep(backoff);
            backoff = (backoff * 2).min(Duration::from_secs(10));
        }
    });
}

fn run_once(app: &AppHandle) -> Result<(), String> {
    let path = paths::api_socket_path(None).ok_or("no config dir")?;
    let mut stream = Stream::connect(&path).map_err(|e| e.to_string())?;

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

    let _ = app.emit("herdr-conn", json!({ "connected": true }));

    for event_line in reader.lines() {
        let event_line = event_line.map_err(|e| e.to_string())?;
        if event_line.is_empty() {
            continue;
        }
        if let Ok(event) = serde_json::from_str::<Value>(&event_line) {
            let _ = app.emit("herdr-event", event);
        }
    }
    Ok(())
}
