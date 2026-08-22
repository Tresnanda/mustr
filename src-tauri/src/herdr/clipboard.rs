//! Local clipboard image reader for remote paste bridging.
//!
//! Mirrors herdr's `remote_image_paste`: when attached to an SSH server the
//! agent runs on the far host and can't see the user's local clipboard, so
//! Mustr reads the image here and ships it over the wire as
//! `ClientMsg::ClipboardImage`. macOS has no GUI clipboard API from a Tauri
//! command, so — like herdr's TUI — we shell out to `osascript` to extract
//! the pasteboard's PNG representation.

use crate::protocol::wire20::MAX_CLIPBOARD_IMAGE_PAYLOAD;

/// An image lifted from the OS clipboard: format extension (no dot) + bytes.
pub struct ClipboardImage {
    pub extension: String,
    pub data: Vec<u8>,
}

/// Reads the current clipboard image, or an `Err` message suitable for a
/// user-facing toast (`"no image"` / `"too large"` / unsupported platform).
pub fn read_image() -> Result<ClipboardImage, String> {
    #[cfg(target_os = "macos")]
    {
        read_image_macos()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("clipboard image paste is only supported on macOS".into())
    }
}

#[cfg(target_os = "macos")]
fn read_image_macos() -> Result<ClipboardImage, String> {
    use std::io::Read;
    use std::sync::atomic::{AtomicU64, Ordering};

    // Unique staging path without Date/random: pid + a monotonic counter.
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!(
        "mustr-clipboard-{}-{}.png",
        std::process::id(),
        n
    ));
    let path_str = path.to_string_lossy().to_string();

    // `the clipboard as «class PNGf»` errors when the pasteboard holds no
    // image, which is exactly the "nothing to paste" signal we want.
    let script = format!(
        "set thePNG to (the clipboard as «class PNGf»)\n\
         set theFile to open for access POSIX file \"{path}\" with write permission\n\
         set eof theFile to 0\n\
         write thePNG to theFile\n\
         close access theFile",
        path = path_str.replace('\\', "\\\\").replace('"', "\\\"")
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("failed to run osascript: {e}"))?;

    if !output.status.success() {
        let _ = std::fs::remove_file(&path);
        // The common case (no image on the clipboard) lands here; keep the
        // message short and human — TerminalView surfaces it as a toast.
        return Err("no image on the clipboard".into());
    }

    let mut file = std::fs::File::open(&path)
        .map_err(|e| format!("clipboard image staging failed: {e}"))?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)
        .map_err(|e| format!("clipboard image read failed: {e}"))?;
    let _ = std::fs::remove_file(&path);

    if data.is_empty() {
        return Err("no image on the clipboard".into());
    }
    if data.len() > MAX_CLIPBOARD_IMAGE_PAYLOAD {
        return Err("clipboard image is too large to paste (max 16 MB)".into());
    }

    Ok(ClipboardImage {
        extension: "png".into(),
        data,
    })
}
