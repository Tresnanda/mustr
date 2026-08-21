//! Remote directory listing for the new-space folder browser. The herdr
//! API has no filesystem surface, so listings run as one-shot `ssh`
//! commands against the saved host — inheriting ~/.ssh/config, keys, and
//! agent exactly like the tunnel does. Unlike the tunnel, browsing wants
//! multiplexing: ControlPersist keeps a master alive for a minute, so the
//! first hop pays the handshake and every navigation after is instant.

use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct RemoteDirEntry {
    pub name: String,
    /// The directory contains a `.git` — likely a repo worth becoming a space.
    pub git: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteDirListing {
    /// Resolved absolute path of the listed directory.
    pub path: String,
    /// The remote user's home, for the sidebar shortcut and ~-display.
    pub home: String,
    pub entries: Vec<RemoteDirEntry>,
}

fn control_path() -> PathBuf {
    std::env::temp_dir().join("mustr-fs-%C")
}

/// POSIX-single-quote a string so it survives the remote shell unparsed.
fn shq(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Lists the directories under `path` on the saved SSH server `id`.
/// An empty/None path lists the remote home. `~` and `~/…` expand there.
pub fn list_dirs(id: &str, path: Option<String>) -> Result<RemoteDirListing, String> {
    let remote = super::servers::load_remotes()
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("unknown device")?;

    let p = path.unwrap_or_default();
    // One script, one round trip: resolve the path, then emit
    // home/pwd headers and a `g|d <tab> name` line per directory.
    let script = format!(
        concat!(
            "p={p}; ",
            r#"case "$p" in "~") p="$HOME";; "~/"*) p="$HOME${{p#\~}}";; esac; "#,
            r#"cd -- "${{p:-$HOME}}" 2>/dev/null || {{ echo MUSTR_NODIR; exit 0; }}; "#,
            r#"printf 'H\t%s\n' "$HOME"; printf 'P\t%s\n' "$PWD"; "#,
            r#"ls -1A 2>/dev/null | while IFS= read -r f; do "#,
            r#"if [ -d "./$f" ]; then "#,
            r#"if [ -e "./$f/.git" ]; then printf 'g\t%s\n' "$f"; else printf 'd\t%s\n' "$f"; fi; "#,
            r#"fi; done"#,
        ),
        p = shq(&p)
    );

    let out = Command::new("ssh")
        .args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"])
        .args(["-o", "ControlMaster=auto", "-o", "ControlPersist=60"])
        .arg("-o")
        .arg(format!("ControlPath={}", control_path().display()))
        .arg(&remote.host)
        .arg(script)
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

    let text = String::from_utf8_lossy(&out.stdout);
    if text.starts_with("MUSTR_NODIR") {
        return Err("no-such-dir".into());
    }
    let mut home = String::new();
    let mut resolved = String::new();
    let mut entries = Vec::new();
    for line in text.lines() {
        let Some((tag, value)) = line.split_once('\t') else {
            continue;
        };
        match tag {
            "H" => home = value.to_owned(),
            "P" => resolved = value.to_owned(),
            "d" | "g" => entries.push(RemoteDirEntry {
                name: value.to_owned(),
                git: tag == "g",
            }),
            _ => {}
        }
    }
    if resolved.is_empty() {
        return Err("could not read that folder".into());
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(RemoteDirListing {
        path: resolved,
        home,
        entries,
    })
}
