//! Per-pane terminal attach actor.
//!
//! Each visible pane gets its own connection to `herdr-client.sock`:
//! Hello (TerminalAnsi + TerminalAttach) → Welcome → ControlTerminal(target),
//! then a reader thread streams `TerminalFrame` ANSI bytes to the frontend
//! while the writer half forwards input/resize/scroll upstream.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use serde_json::json;

use crate::protocol::{ClientMsg, Codec, ServerFrame};


#[cfg(unix)]
type Stream = std::os::unix::net::UnixStream;

/// Events streamed to the frontend over a Tauri channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TermEvent {
    /// Handshake completed; the pane is live.
    Connected { seq_hint: u64 },
    /// Raw ANSI bytes, base64-encoded. `full` marks a complete repaint.
    Data { b64: String, full: bool, cols: u16, rows: u16 },
    /// Terminal title reported by the server.
    Title { title: String },
    /// The child app enabled/disabled mouse tracking: when enabled the client
    /// must forward wheel events as VT mouse sequences instead of AttachScroll.
    MouseCapture { enabled: bool },
    /// Server shut down or force-detached this connection.
    Closed { reason: Option<String> },
}

pub struct Attachment {
    writer: Mutex<Stream>,
    codec: Codec,
    alive: AtomicBool,
}


impl Attachment {
    pub fn open(
        server: &str,
        target: &str,
        cols: u16,
        rows: u16,
        on_event: impl Fn(TermEvent) + Send + 'static,
    ) -> Result<std::sync::Arc<Self>, String> {
        let (_, path) = super::servers::paths_for(server)?;
        let mut stream = Stream::connect(&path)
            .map_err(|e| format!("herdr render socket not reachable at {}: {e}", path.display()))?;

        // Negotiate the wire generation before Hello: the server rejects
        // mismatched clients outright, so we must speak *its* protocol. The
        // JSON API's ping announces it (see docs/protocol-notes.md).
        let codec = negotiate(server)?;

        codec
            .write(&mut stream, &ClientMsg::Hello { cols, rows })
            .map_err(|e| format!("handshake write failed: {e}"))?;

        match codec.read(&mut stream).map_err(|e| format!("handshake read failed: {e}"))? {
            ServerFrame::Welcome { error: None, .. } => {}
            ServerFrame::Welcome {
                error: Some(err),
                version,
            } => {
                return Err(format!(
                    "server rejected client (server protocol {version}): {err}"
                ));
            }
            other => return Err(format!("unexpected handshake reply: {other:?}")),
        }

        codec
            .write(
                &mut stream,
                &ClientMsg::ControlTerminal {
                    target: target.to_owned(),
                    takeover: true,
                },
            )
            .map_err(|e| format!("attach write failed: {e}"))?;

        let mut read_half = stream
            .try_clone()
            .map_err(|e| format!("socket clone failed: {e}"))?;
        let attachment = std::sync::Arc::new(Self {
            writer: Mutex::new(stream),
            codec,
            alive: AtomicBool::new(true),
        });

        on_event(TermEvent::Connected { seq_hint: 0 });

        let for_reader = std::sync::Arc::clone(&attachment);
        std::thread::spawn(move || {
            loop {
                if !for_reader.alive.load(Ordering::Relaxed) {
                    break;
                }
                match for_reader.codec.read(&mut read_half) {
                    Ok(ServerFrame::Terminal(frame)) => on_event(TermEvent::Data {
                        b64: B64.encode(&frame.bytes),
                        full: frame.full,
                        cols: frame.width,
                        rows: frame.height,
                    }),
                    Ok(ServerFrame::WindowTitle(Some(title))) => {
                        on_event(TermEvent::Title { title })
                    }
                    Ok(ServerFrame::MouseCapture(enabled)) => {
                        on_event(TermEvent::MouseCapture { enabled })
                    }
                    Ok(ServerFrame::ServerShutdown(reason)) => {
                        on_event(TermEvent::Closed { reason });
                        break;
                    }
                    // Welcome, semantic frames, graphics, clipboard, bells,
                    // titles cleared to None: not acted on in TerminalAnsi
                    // attach mode.
                    Ok(_) => {}
                    Err(err) => {
                        let reason = if for_reader.alive.load(Ordering::Relaxed) {
                            Some(format!("connection lost: {err}"))
                        } else {
                            None // deliberate local detach
                        };
                        on_event(TermEvent::Closed { reason });
                        break;
                    }
                }
            }
        });

        Ok(attachment)
    }

    fn send(&self, msg: &ClientMsg) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|_| "writer poisoned")?;
        self.codec
            .write(&mut *writer, msg)
            .map_err(|e| format!("send failed: {e}"))
    }

    pub fn input(&self, data: Vec<u8>) -> Result<(), String> {
        self.send(&ClientMsg::Input { data })
    }

    /// Bridges a local clipboard image to the (remote) server for paste.
    pub fn clipboard_image(&self, extension: String, data: Vec<u8>) -> Result<(), String> {
        self.send(&ClientMsg::ClipboardImage { extension, data })
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.send(&ClientMsg::Resize { cols, rows })
    }

    pub fn scroll(
        &self,
        up: bool,
        lines: u16,
        column: Option<u16>,
        row: Option<u16>,
    ) -> Result<(), String> {
        self.send(&ClientMsg::Scroll {
            up,
            lines,
            column,
            row,
        })
    }

    pub fn detach(&self) {
        self.alive.store(false, Ordering::Relaxed);
        let _ = self.send(&ClientMsg::Detach);
        if let Ok(writer) = self.writer.lock() {
            let _ = writer.shutdown(std::net::Shutdown::Both);
        }
    }
}

/// Asks the server which wire generation it speaks (JSON API `ping`) and
/// returns a matching [`Codec`].
///
/// herdr rejects mismatched clients at handshake, and the binary protocol's
/// variant indices shift between generations — there is no "speak older"
/// fallback. An unsupported server needs a Mustr release vendored for it.
fn negotiate(server: &str) -> Result<Codec, String> {
    let result = super::api::request(server, "ping", json!({}))?;
    let protocol = result["protocol"].as_u64().unwrap_or(0) as u32;
    let gen = crate::protocol::Gen::from_server_protocol(protocol).ok_or_else(|| {
        format!(
            "herdr server speaks wire protocol {protocol}, but this build supports {}–{} \
             (see the release notes for the compatible herdr version)",
            crate::protocol::MIN_SUPPORTED_PROTOCOL,
            crate::protocol::MAX_SUPPORTED_PROTOCOL
        )
    })?;
    Ok(Codec::new(gen))
}
