//! Socket path resolution for a herdr server's default session.
//! Mirrors herdr's own layout: `~/.config/herdr/` on unix,
//! `%APPDATA%\herdr\` on Windows; named sessions under `sessions/<name>/`.

use std::path::PathBuf;

pub fn herdr_data_dir() -> Option<PathBuf> {
    #[cfg(unix)]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config").join("herdr"))
    }
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("herdr"))
    }
}

fn session_dir(session: Option<&str>) -> Option<PathBuf> {
    let base = herdr_data_dir()?;
    Some(match session {
        None | Some("default") => base,
        Some(name) => base.join("sessions").join(name),
    })
}

pub fn api_socket_path(session: Option<&str>) -> Option<PathBuf> {
    Some(session_dir(session)?.join("herdr.sock"))
}

pub fn client_socket_path(session: Option<&str>) -> Option<PathBuf> {
    Some(session_dir(session)?.join("herdr-client.sock"))
}
