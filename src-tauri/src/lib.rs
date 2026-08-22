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
/// Tauri v2 runs sync commands on the main/UI thread (wry delivers IPC in
/// the webview delegate), so anything that touches the daemon socket or
/// spawns a process MUST be async + spawn_blocking to keep the UI thread
/// free (see issue #1 stack samples).
#[tauri::command]
async fn api_request(
    server: String,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        herdr::api::request(&server, &method, params.unwrap_or_else(|| serde_json::json!({})))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_summaries(
    cwds: Vec<String>,
) -> Result<std::collections::HashMap<String, herdr::gitinfo::GitSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(herdr::gitinfo::summaries(cwds)))
        .await
        .map_err(|e| e.to_string())?
}


/// Lists directories on a saved SSH server for the new-space browser.
/// Sync command → runs on the main thread; the frontend only calls this
/// from explicit dialogs, never on a timer.
#[tauri::command]
fn remote_list_dirs(
    server: String,
    path: Option<String>,
) -> Result<herdr::remotefs::RemoteDirListing, String> {
    herdr::remotefs::list_dirs(&server, path)
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

/// Ensure a live connection for this server id (no-op when already
/// pooled) and its event stream. Blocking is fine: non-async commands run
/// off the main thread, and the frontend shows a connecting state.
#[tauri::command]
fn server_connect(app: tauri::AppHandle, id: String) -> Result<String, String> {
    herdr::servers::connect(&id)?;
    herdr::events::ensure_stream(app, id.clone());
    Ok(id)
}

#[tauri::command]
fn server_disconnect(id: String) -> Vec<ServerRow> {
    herdr::servers::disconnect(&id);
    herdr::servers::list()
}

/// Open (or focus) a dedicated window bound to one server, so several
/// hosts can be on screen at once. The window's URL carries the id.
#[tauri::command]
fn open_host_window(app: tauri::AppHandle, id: String) -> Result<(), String> {
    use tauri::Manager;

    herdr::servers::connect(&id)?;
    herdr::events::ensure_stream(app.clone(), id.clone());

    let safe: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let label = format!("host-{safe}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_focus();
        return Ok(());
    }

    let name = herdr::servers::list()
        .into_iter()
        .find(|s| s.id == id)
        .map(|s| s.name)
        .unwrap_or_else(|| id.clone());

    let win = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(format!("index.html?server={id}").into()),
    )
    .title(format!("Mustr — {name}"))
    .inner_size(1200.0, 780.0)
    .min_inner_size(720.0, 480.0)
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .hidden_title(true)
    .transparent(true)
    .build()
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        use tauri::window::{Effect, EffectsBuilder};
        let _ = win.set_effects(
            EffectsBuilder::new()
                .effect(Effect::UnderWindowBackground)
                .build(),
        );
    }
    #[cfg(not(target_os = "macos"))]
    let _ = win;
    Ok(())
}

#[tauri::command]
fn attach_pane(
    server: String,
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
    let attachment = Attachment::open(&server, &target, cols, rows, move |event| {
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

/// Reads this machine's clipboard image and bridges it to the pane's
/// (remote) server for paste — the GUI counterpart to herdr's
/// `remote_image_paste`. Async + spawn_blocking: osascript can take ~100ms
/// and must not stall the UI thread. On success the far-side agent receives
/// the image; errors ("no image", "too large") bubble up for a toast.
#[tauri::command]
async fn pane_clipboard_image(
    attach_id: String,
    state: State<'_, Attachments>,
) -> Result<(), String> {
    let attachment = get(&state, &attach_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let image = herdr::clipboard::read_image()?;
        attachment.clipboard_image(image.extension, image.data)
    })
    .await
    .map_err(|e| e.to_string())?
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Establish the local server (auto-spawning herdr if needed)
            // before the event loop starts hammering a dead socket.
            std::thread::spawn(|| {
                let _ = herdr::servers::connect("local");
            });
            herdr::servers::spawn_supervisor(app.handle().clone());
            herdr::events::ensure_stream(app.handle().clone(), "local".into());
            herdr::gitinfo::init(app.handle().clone());
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
            remote_list_dirs,
            servers_list,
            server_add,
            ssh_aliases,
            server_remove,
            server_connect,
            server_disconnect,
            open_host_window,
            attach_pane,
            pane_input,
            pane_clipboard_image,
            pane_resize,
            pane_scroll,
            detach_pane,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
