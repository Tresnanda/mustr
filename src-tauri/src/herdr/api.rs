//! Herdr JSON API client (`herdr.sock`): newline-delimited JSON
//! request/response. One connection per request — not a style choice:
//! herdr's api server (src/api/server.rs, v0.8.0) reads a single request
//! line per connection and closes after responding (only events.subscribe
//! and wait stream). Caching connections here buys nothing; over an SSH
//! tunnel each request costs one channel open + one round trip, so the
//! lever for remote snappiness is fewer requests, not reused sockets.

use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

use serde_json::{json, Value};


#[cfg(unix)]
type Stream = std::os::unix::net::UnixStream;

fn connect(server: &str) -> Result<Stream, String> {
    let (path, _) = super::servers::paths_for(server)?;
    let stream = Stream::connect(&path)
        .map_err(|e| format!("herdr server not reachable at {}: {e}", path.display()))?;
    // A read that outlives this is a dead tunnel, not a slow reply; time
    // out so the caller can recover instead of hanging an invoke forever.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    Ok(stream)
}

/// Sends one request and returns the parsed `result`, or an error string
/// built from the API's `error` object.
pub fn request(server: &str, method: &str, params: Value) -> Result<Value, String> {
    let mut stream = connect(server)?;
    let req = json!({ "id": "mustr", "method": method, "params": params });
    let mut line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
    line.push('\n');
    stream
        .write_all(line.as_bytes())
        .map_err(|e| format!("api write failed: {e}"))?;

    let mut reader = BufReader::new(stream);
    let mut resp = String::new();
    reader
        .read_line(&mut resp)
        .map_err(|e| format!("api read failed: {e}"))?;
    let parsed: Value =
        serde_json::from_str(&resp).map_err(|e| format!("api response parse failed: {e}"))?;

    if let Some(err) = parsed.get("error") {
        let msg = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown API error");
        return Err(msg.to_owned());
    }
    Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
}
