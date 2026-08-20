mod herdr;
mod protocol;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::State;

use herdr::servers::ServerRow;
use herdr::term::{Attachment, TermEvent};

/// Live pane attachments, keyed by frontend-chosen attach id.
#[derive(Default)]
struct Attachments(Mutex<HashMap<String, Arc<Attachment>>>);

/// Generic JSON API passthrough: the frontend calls herdr methods directly
/// (`ping`, `pane.list`, `session.snapshot`, `pane.split`, ...).
#[tauri::command]
fn api_request(method: String, params: Option<Value>) -> Result<Value, String> {
    herdr::api::request(None, &method, params.unwrap_or_else(|| serde_json::json!({})))
}

#[tauri::command]
fn git_summaries(cwds: Vec<String>) -> std::collections::HashMap<String, herdr::gitinfo::GitSummary> {
    herdr::gitinfo::summaries(cwds)
}

#[tauri::command]
fn servers_list() -> Vec<ServerRow> {
    herdr::servers::list()
}

#[tauri::command]
fn server_add(name: String, host: String) -> Result<Vec<ServerRow>, String> {
    herdr::servers::add(name, host)
}

#[tauri::command]
fn ssh_aliases() -> Vec<String> {
    herdr::servers::ssh_aliases()
}

#[tauri::command]
fn server_remove(id: String) -> Result<Vec<ServerRow>, String> {
    herdr::servers::remove(&id)
}

/// Blocking is fine: non-async commands run off the main thread, and the
/// frontend shows a connecting state meanwhile.
#[tauri::command]
fn server_connect(id: String) -> Result<String, String> {
    if id == "local" {
        herdr::servers::switch_to_local()?;
    } else {
        herdr::servers::connect_remote(&id)?;
    }
    Ok(herdr::servers::active_id())
}

#[tauri::command]
fn attach_pane(
    attach_id: String,
    target: String,
    cols: u16,
    rows: u16,
    on_event: Channel<TermEvent>,
    state: State<'_, Attachments>,
) -> Result<(), String> {
    // Replace any previous attachment under this id (e.g. hot re-attach).
    if let Some(old) = state.0.lock().unwrap().remove(&attach_id) {
        old.detach();
    }
    let attachment = Attachment::open(None, &target, cols, rows, move |event| {
        let _ = on_event.send(event);
    })?;
    state.0.lock().unwrap().insert(attach_id, attachment);
    Ok(())
}

#[tauri::command]
fn pane_input(attach_id: String, b64: String, state: State<'_, Attachments>) -> Result<(), String> {
    let data = B64.decode(b64).map_err(|e| format!("bad input payload: {e}"))?;
    let attachment = get(&state, &attach_id)?;
    attachment.input(data)
}

#[tauri::command]
fn pane_resize(
    attach_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, Attachments>,
) -> Result<(), String> {
    get(&state, &attach_id)?.resize(cols, rows)
}

#[tauri::command]
fn pane_scroll(
    attach_id: String,
    up: bool,
    lines: u16,
    column: Option<u16>,
    row: Option<u16>,
    state: State<'_, Attachments>,
) -> Result<(), String> {
    get(&state, &attach_id)?.scroll(up, lines, column, row)
}

#[tauri::command]
fn detach_pane(attach_id: String, state: State<'_, Attachments>) {
    if let Some(attachment) = state.0.lock().unwrap().remove(&attach_id) {
        attachment.detach();
    }
}

fn get(state: &State<'_, Attachments>, id: &str) -> Result<Arc<Attachment>, String> {
    state
        .0
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| format!("no attachment '{id}'"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Establish the local server (auto-spawning herdr if needed)
            // before the event loop starts hammering a dead socket.
            std::thread::spawn(|| {
                let _ = herdr::servers::switch_to_local();
            });
            herdr::servers::spawn_supervisor(app.handle().clone());
            herdr::events::spawn(app.handle().clone());
            #[cfg(target_os = "macos")]
            {
                use tauri::window::{Effect, EffectsBuilder};
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_effects(
                        EffectsBuilder::new()
                            .effect(Effect::UnderWindowBackground)
                            .build(),
                    );
                }
            }
            Ok(())
        })
        .manage(Attachments::default())
        .invoke_handler(tauri::generate_handler![
            api_request,
            git_summaries,
            servers_list,
            server_add,
            ssh_aliases,
            server_remove,
            server_connect,
            attach_pane,
            pane_input,
            pane_resize,
            pane_scroll,
            detach_pane,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
