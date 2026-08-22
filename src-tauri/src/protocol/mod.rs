//! Wire-protocol façade: two vendored generations behind one stable API.
//!
//! herdr bumps `PROTOCOL_VERSION` on incompatible wire changes and rejects
//! mismatched clients at handshake, so Mustr must speak the *server's*
//! generation exactly. Both generations are vendored verbatim:
//!
//! - [`wire19`] — herdr v0.8.0, protocol 19
//! - [`wire20`] — herdr v0.8.2, protocol 20
//!
//! v20 appends new enum variants at the end of both message enums (safe for
//! old indices) but inserts `ClientLaunchMode::AppDirectGraphics` mid-enum
//! and adds a field to `MouseCapture`. This module hides those differences:
//! callers construct generation-agnostic [`ClientMsg`] values and read back
//! [`ServerFrame`] values, and the [`Codec`] picks the right vendored types
//! per negotiated generation.
//!
//! Adding a future generation: vendor `wireNN.rs`, add a `Gen` variant, and
//! extend the two mapping functions in `Codec`.

pub mod wire19;
pub mod wire20;

use std::io::{Read, Write};

use wire19::{AttachScrollDirection, AttachScrollSource, TerminalFrame};

/// Highest protocol generation this build speaks.
pub const MAX_SUPPORTED_PROTOCOL: u32 = wire20::PROTOCOL_VERSION;
/// Lowest protocol generation this build speaks.
pub const MIN_SUPPORTED_PROTOCOL: u32 = wire19::PROTOCOL_VERSION;

/// Re-exported framing limits (identical in both vendored generations).
pub use wire19::{read_message as read_raw, write_message as write_raw, FramingError};

/// Which vendored wire generation a connection speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gen {
    V19,
    V20,
}

impl Gen {
    /// Picks the generation matching a server-announced protocol number.
    pub fn from_server_protocol(protocol: u32) -> Option<Gen> {
        match protocol {
            wire19::PROTOCOL_VERSION => Some(Gen::V19),
            wire20::PROTOCOL_VERSION => Some(Gen::V20),
            _ => None,
        }
    }
}

/// Generation-agnostic client → server messages Mustr sends.
///
/// Only the subset the attach path needs; extend as features grow. Every
/// variant here is byte-compatible across generations except `Hello`
/// (version field + `TerminalAttach` discriminant), which `Codec` handles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientMsg {
    Hello { cols: u16, rows: u16 },
    Input { data: Vec<u8> },
    /// Local clipboard image bridged to a remote server for paste (herdr's
    /// `remote_image_paste`). `extension` is the format without a leading dot.
    ClipboardImage { extension: String, data: Vec<u8> },
    Resize { cols: u16, rows: u16 },
    Scroll { up: bool, lines: u16, column: Option<u16>, row: Option<u16> },
    ControlTerminal { target: String, takeover: bool },
    Detach,
}

/// Generation-agnostic server → client frames Mustr reacts to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerFrame {
    Welcome { version: u32, error: Option<String> },
    Terminal(TerminalFrame),
    WindowTitle(Option<String>),
    MouseCapture(bool),
    ServerShutdown(Option<String>),
    /// Any frame this build doesn't act on (semantic frames, graphics,
    /// clipboard, bells, …). Must stay decodable, hence per-generation enums.
    Ignored,
}

/// Encodes/decodes one connection's frames in its negotiated generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Codec(Gen);

impl Codec {
    pub fn new(gen: Gen) -> Codec {
        Codec(gen)
    }

    /// Serializes and writes one length-prefixed frame.
    pub fn write<W: Write>(&self, writer: &mut W, msg: &ClientMsg) -> Result<(), FramingError> {
        match self.0 {
            Gen::V19 => write_raw(writer, &self.to_v19(msg)),
            Gen::V20 => write_raw(writer, &self.to_v20(msg)),
        }
    }

    /// Reads one length-prefixed frame and maps it to [`ServerFrame`].
    pub fn read<R: Read>(&self, reader: &mut R) -> Result<ServerFrame, FramingError> {
        let frame = match self.0 {
            Gen::V19 => self.from_v19(read_raw::<_, wire19::ServerMessage>(
                reader,
                wire19::MAX_GRAPHICS_FRAME_SIZE,
            )?),
            Gen::V20 => self.from_v20(read_raw::<_, wire20::ServerMessage>(
                reader,
                wire20::MAX_GRAPHICS_FRAME_SIZE,
            )?),
        };
        Ok(frame)
    }

    fn to_v19(&self, msg: &ClientMsg) -> wire19::ClientMessage {
        use wire19::{ClientKeybindings, ClientLaunchMode, ClientMessage as M, RenderEncoding};
        match msg {
            ClientMsg::Hello { cols, rows } => M::Hello {
                version: wire19::PROTOCOL_VERSION,
                cols: *cols,
                rows: *rows,
                cell_width_px: 0,
                cell_height_px: 0,
                requested_encoding: RenderEncoding::TerminalAnsi,
                keybindings: ClientKeybindings::Server,
                launch_mode: ClientLaunchMode::TerminalAttach,
            },
            ClientMsg::Input { data } => M::Input { data: data.clone() },
            ClientMsg::ClipboardImage { extension, data } => M::ClipboardImage {
                extension: extension.clone(),
                data: data.clone(),
            },
            ClientMsg::Resize { cols, rows } => M::Resize {
                cols: *cols,
                rows: *rows,
                cell_width_px: 0,
                cell_height_px: 0,
            },
            ClientMsg::Scroll { up, lines, column, row } => M::AttachScroll {
                source: AttachScrollSource::Wheel,
                direction: if *up { AttachScrollDirection::Up } else { AttachScrollDirection::Down },
                lines: *lines,
                column: *column,
                row: *row,
                modifiers: 0,
            },
            ClientMsg::ControlTerminal { target, takeover } => M::ControlTerminal {
                target: target.clone(),
                takeover: *takeover,
            },
            ClientMsg::Detach => M::Detach,
        }
    }

    fn to_v20(&self, msg: &ClientMsg) -> wire20::ClientMessage {
        use wire20::{AttachScrollDirection, AttachScrollSource, ClientKeybindings, ClientLaunchMode, ClientMessage as M, RenderEncoding};
        match msg {
            ClientMsg::Hello { cols, rows } => M::Hello {
                version: wire20::PROTOCOL_VERSION,
                cols: *cols,
                rows: *rows,
                cell_width_px: 0,
                cell_height_px: 0,
                requested_encoding: RenderEncoding::TerminalAnsi,
                keybindings: ClientKeybindings::Server,
                launch_mode: ClientLaunchMode::TerminalAttach,
            },
            ClientMsg::Input { data } => M::Input { data: data.clone() },
            ClientMsg::ClipboardImage { extension, data } => M::ClipboardImage {
                extension: extension.clone(),
                data: data.clone(),
            },
            ClientMsg::Resize { cols, rows } => M::Resize {
                cols: *cols,
                rows: *rows,
                cell_width_px: 0,
                cell_height_px: 0,
            },
            ClientMsg::Scroll { up, lines, column, row } => M::AttachScroll {
                source: AttachScrollSource::Wheel,
                direction: if *up { AttachScrollDirection::Up } else { AttachScrollDirection::Down },
                lines: *lines,
                column: *column,
                row: *row,
                modifiers: 0,
            },
            ClientMsg::ControlTerminal { target, takeover } => M::ControlTerminal {
                target: target.clone(),
                takeover: *takeover,
            },
            ClientMsg::Detach => M::Detach,
        }
    }

    fn from_v19(&self, msg: wire19::ServerMessage) -> ServerFrame {
        use wire19::ServerMessage as M;
        match msg {
            M::Welcome { version, error, .. } => ServerFrame::Welcome { version, error },
            M::Terminal(frame) => ServerFrame::Terminal(frame),
            M::WindowTitle { title } => ServerFrame::WindowTitle(title),
            M::MouseCapture { enabled } => ServerFrame::MouseCapture(enabled),
            M::ServerShutdown { reason } => ServerFrame::ServerShutdown(reason),
            _ => ServerFrame::Ignored,
        }
    }

    fn from_v20(&self, msg: wire20::ServerMessage) -> ServerFrame {
        use wire20::ServerMessage as M;
        match msg {
            M::Welcome { version, error, .. } => ServerFrame::Welcome { version, error },
            M::Terminal(frame) => ServerFrame::Terminal(TerminalFrame {
                seq: frame.seq,
                width: frame.width,
                height: frame.height,
                full: frame.full,
                bytes: frame.bytes,
            }),
            M::WindowTitle { title } => ServerFrame::WindowTitle(title),
            M::MouseCapture { enabled, .. } => ServerFrame::MouseCapture(enabled),
            M::ServerShutdown { reason } => ServerFrame::ServerShutdown(reason),
            _ => ServerFrame::Ignored,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `TerminalFrame` is structurally identical in both generations, so the
    /// façade re-exports v19's; assert the v20 one decodes into it via a
    /// full Codec round-trip of the frames Mustr reacts to.
    #[test]
    fn roundtrips_both_generations() {
        for gen in [Gen::V19, Gen::V20] {
            let codec = Codec::new(gen);

            // Terminal frame round-trip.
            let frame = TerminalFrame {
                seq: 7,
                width: 80,
                height: 24,
                full: true,
                bytes: b"\x1b[2J".to_vec(),
            };
            let mut buf = Vec::new();
            match gen {
                Gen::V19 => write_raw(
                    &mut buf,
                    &wire19::ServerMessage::Terminal(frame.clone()),
                )
                .unwrap(),
                Gen::V20 => write_raw(
                    &mut buf,
                    &wire20::ServerMessage::Terminal(wire20::TerminalFrame {
                        seq: frame.seq,
                        width: frame.width,
                        height: frame.height,
                        full: frame.full,
                        bytes: frame.bytes.clone(),
                    }),
                )
                .unwrap(),
            }
            assert_eq!(
                codec.read(&mut std::io::Cursor::new(buf)).unwrap(),
                ServerFrame::Terminal(frame)
            );
        }
    }

    /// v20 `MouseCapture` carries an extra `sgr_pixels` field; the façade
    /// must still decode it and surface `enabled`.
    #[test]
    fn v20_mouse_capture_decodes() {
        let codec = Codec::new(Gen::V20);
        let msg = wire20::ServerMessage::MouseCapture { enabled: true, sgr_pixels: false };
        let mut buf = Vec::new();
        write_raw(&mut buf, &msg).unwrap();
        assert_eq!(
            codec.read(&mut std::io::Cursor::new(buf)).unwrap(),
            ServerFrame::MouseCapture(true)
        );
    }

    /// The `Hello` bytes must differ between generations (version + shifted
    /// `TerminalAttach` discriminant) — this is exactly the v19/v20 skew.
    #[test]
    fn hello_differs_across_generations() {
        let mut b19 = Vec::new();
        Codec::new(Gen::V19)
            .write(&mut b19, &ClientMsg::Hello { cols: 80, rows: 24 })
            .unwrap();
        let mut b20 = Vec::new();
        Codec::new(Gen::V20)
            .write(&mut b20, &ClientMsg::Hello { cols: 80, rows: 24 })
            .unwrap();
        assert_ne!(b19, b20);
        // Shared prefix: same length prefix + variant index + unchanged
        // leading fields; they diverge at the version/launch_mode bytes.
        let common = b19.iter().zip(b20.iter()).take_while(|(a, b)| a == b).count();
        assert!(common > 4, "Hello should share a structural prefix");
        assert!(common < b19.len());
    }

    /// Negotiation covers exactly the vendored generations.
    #[test]
    fn gen_negotiation() {
        assert_eq!(Gen::from_server_protocol(19), Some(Gen::V19));
        assert_eq!(Gen::from_server_protocol(20), Some(Gen::V20));
        assert_eq!(Gen::from_server_protocol(21), None);
        assert_eq!(Gen::from_server_protocol(18), None);
    }
}
