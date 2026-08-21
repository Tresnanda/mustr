//! Live-server probe #4: does an SGR click via Input actually drive a
//! mouse-tracking TUI? Witness: `vim` with mouse=a — a click at a cell
//! moves vim's cursor there, visible in the next frame's cursor position.
//! Scratch workspace; closed afterwards.

use std::sync::mpsc;
use std::time::Duration;

use serde_json::json;

use super::{api, term};

fn drain(rx: &mpsc::Receiver<term::TermEvent>, ms: u64) -> Vec<u8> {
    let mut all = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_millis(ms);
    while let Ok(event) =
        rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
    {
        if let term::TermEvent::Data { b64, .. } = event {
            use base64::Engine as _;
            all.extend(base64::engine::general_purpose::STANDARD.decode(b64).unwrap());
        }
    }
    all
}

fn contains(h: &[u8], n: &[u8]) -> bool {
    h.windows(n.len()).any(|w| w == n)
}

#[test]
#[ignore]
fn probe_live() {
    let ws = api::request("local", "workspace.create", json!({"cwd": "/tmp"}))
        .expect("workspace.create");
    let pane_id = ws["root_pane"]["pane_id"].as_str().unwrap().to_owned();
    let ws_id = ws["workspace"]["workspace_id"].as_str().unwrap().to_owned();

    let (tx, rx) = mpsc::channel::<term::TermEvent>();
    let attachment = term::Attachment::open("local", &pane_id, 80, 24, move |e| {
        let _ = tx.send(e);
    })
    .expect("attach");
    drain(&rx, 1200);

    // vim with mouse on, some buffer lines to click around in.
    attachment
        .input(b"vim -u NONE -N -c 'set mouse=a' -c 'call setline(1, repeat([\"xxxxxxxxxxxxxxxxxxxxxxx\"], 15))'\n".to_vec())
        .expect("vim");
    drain(&rx, 2500);

    // Click at column 12, row 7 (1-based SGR press+release).
    attachment
        .input(b"\x1b[<0;12;7M\x1b[<0;12;7m".to_vec())
        .expect("click");
    drain(&rx, 800);
    // Ask vim where its cursor is; render it on the status line.
    attachment
        .input(b":echo 'CURSOR_' . line('.') . '_' . col('.')\r".to_vec())
        .expect("echo");
    let out = drain(&rx, 1500);
    let text = String::from_utf8_lossy(&out);
    println!(
        "CLICK_MOVED_VIM_CURSOR={} (expect CURSOR_7_12)",
        text.contains("CURSOR_7_12")
    );
    if let Some(i) = text.find("CURSOR_") {
        println!("cursor report: {}", &text[i..i.min(text.len().saturating_sub(1)).min(i) + 20.min(text.len() - i)]);
    }
    let ec = contains(&out, b"CURSOR_");
    println!("cursor_report_seen={ec}");

    attachment.input(b"\x1b:q!\r".to_vec()).expect("quit");
    drain(&rx, 800);
    attachment.detach();
    let closed = api::request("local", "workspace.close", json!({"workspace_id": ws_id}));
    println!("== closed: {closed:?}");
}
