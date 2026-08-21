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

use crate::protocol::wire::{
    self, AttachScrollDirection, AttachScrollSource, ClientKeybindings, ClientLaunchMode,
    ClientInputEvent, ClientMessage, ClientMouseButton, ClientMouseKind, RenderEncoding,
    ServerMessage,
};


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

        wire::write_message(
            &mut stream,
            &ClientMessage::Hello {
                version: wire::PROTOCOL_VERSION,
                cols,
                rows,
                cell_width_px: 0,
                cell_height_px: 0,
                requested_encoding: RenderEncoding::TerminalAnsi,
                keybindings: ClientKeybindings::Server,
                launch_mode: ClientLaunchMode::TerminalAttach,
            },
        )
        .map_err(|e| format!("handshake write failed: {e}"))?;

        let welcome: ServerMessage =
            wire::read_message(&mut stream, wire::MAX_GRAPHICS_FRAME_SIZE)
                .map_err(|e| format!("handshake read failed: {e}"))?;
        match welcome {
            ServerMessage::Welcome { error: None, .. } => {}
            ServerMessage::Welcome { error: Some(err), version, .. } => {
                return Err(format!(
                    "server rejected client (server protocol {version}): {err}"
                ));
            }
            other => return Err(format!("unexpected handshake reply: {other:?}")),
        }

        wire::write_message(
            &mut stream,
            &ClientMessage::ControlTerminal {
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
            alive: AtomicBool::new(true),
        });

        on_event(TermEvent::Connected { seq_hint: 0 });

        let for_reader = std::sync::Arc::clone(&attachment);
        std::thread::spawn(move || {
            loop {
                if !for_reader.alive.load(Ordering::Relaxed) {
                    break;
                }
                match wire::read_message::<_, ServerMessage>(
                    &mut read_half,
                    wire::MAX_GRAPHICS_FRAME_SIZE,
                ) {
                    Ok(ServerMessage::Terminal(frame)) => on_event(TermEvent::Data {
                        b64: B64.encode(&frame.bytes),
                        full: frame.full,
                        cols: frame.width,
                        rows: frame.height,
                    }),
                    Ok(ServerMessage::WindowTitle { title: Some(title) }) => {
                        on_event(TermEvent::Title { title })
                    }
                    Ok(ServerMessage::MouseCapture { enabled }) => {
                        on_event(TermEvent::MouseCapture { enabled })
                    }
                    Ok(ServerMessage::ServerShutdown { reason }) => {
                        on_event(TermEvent::Closed { reason });
                        break;
                    }
                    // Semantic frames, graphics, clipboard, sounds: not used in
                    // TerminalAnsi attach mode (graphics/clipboard land in M1+).
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

    fn send(&self, msg: &ClientMessage) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|_| "writer poisoned")?;
        wire::write_message(&mut *writer, msg).map_err(|e| format!("send failed: {e}"))
    }

    pub fn input(&self, data: Vec<u8>) -> Result<(), String> {
        self.send(&ClientMessage::Input { data })
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.send(&ClientMessage::Resize {
            cols,
            rows,
            cell_width_px: 0,
            cell_height_px: 0,
        })
    }

    pub fn scroll(&self, up: bool, lines: u16, column: Option<u16>, row: Option<u16>) -> Result<(), String> {
        self.send(&ClientMessage::AttachScroll {
            source: AttachScrollSource::Wheel,
            direction: if up {
                AttachScrollDirection::Up
            } else {
                AttachScrollDirection::Down
            },
            lines,
            column,
            row,
            modifiers: 0,
        })
    }

    /// Structured mouse event — the wire has a first-class Mouse message;
    /// synthesizing SGR bytes into Input is not something the server parses.
    pub fn mouse(
        &self,
        kind: &str,
        button: &str,
        column: u16,
        row: u16,
        modifiers: u8,
    ) -> Result<(), String> {
        let btn = match button {
            "right" => ClientMouseButton::Right,
            "middle" => ClientMouseButton::Middle,
            _ => ClientMouseButton::Left,
        };
        let kind = match kind {
            "down" => ClientMouseKind::Down(btn),
            "up" => ClientMouseKind::Up(btn),
            "drag" => ClientMouseKind::Drag(btn),
            "move" => ClientMouseKind::Moved,
            "scroll-up" => ClientMouseKind::ScrollUp,
            "scroll-down" => ClientMouseKind::ScrollDown,
            other => return Err(format!("unknown mouse kind '{other}'")),
        };
        self.send(&ClientMessage::InputEvents {
            events: vec![ClientInputEvent::Mouse {
                kind,
                column,
                row,
                modifiers,
            }],
        })
    }

    pub fn detach(&self) {
        self.alive.store(false, Ordering::Relaxed);
        let _ = self.send(&ClientMessage::Detach);
        if let Ok(writer) = self.writer.lock() {
            let _ = writer.shutdown(std::net::Shutdown::Both);
        }
    }
}
