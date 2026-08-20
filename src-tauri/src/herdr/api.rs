//! Herdr JSON API client (`herdr.sock`): newline-delimited JSON
//! request/response. One connection per request — the same pattern the
//! herdr CLI uses; a persistent subscription connection comes with M1.

use std::io::{BufRead, BufReader, Write};

use serde_json::{json, Value};

use super::paths;

#[cfg(unix)]
type Stream = std::os::unix::net::UnixStream;

fn connect(session: Option<&str>) -> Result<Stream, String> {
    let path = paths::api_socket_path(session).ok_or("could not resolve herdr config dir")?;
    Stream::connect(&path).map_err(|e| format!("herdr server not reachable at {}: {e}", path.display()))
}

/// Sends one request and returns the parsed `result`, or an error string
/// built from the API's `error` object.
pub fn request(session: Option<&str>, method: &str, params: Value) -> Result<Value, String> {
    let mut stream = connect(session)?;
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
