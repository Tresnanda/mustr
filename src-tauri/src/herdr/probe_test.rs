//! Live-server probe #3: is always-forwarding SGR click bytes safe for a
//! plain shell prompt? Scratch workspace; closed afterwards.

use std::sync::mpsc;
use std::time::Duration;

use serde_json::json;

use super::{api, term};

fn drain_text(rx: &mpsc::Receiver<term::TermEvent>, ms: u64) -> String {
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
    String::from_utf8_lossy(&all).into_owned()
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
    drain_text(&rx, 1500);

    // Click storm at the idle shell prompt: press, drag, release, wheel.
    attachment
        .input(b"\x1b[<0;5;2M\x1b[<32;6;2M\x1b[<0;6;2m\x1b[<64;5;2M\x1b[<65;5;2M".to_vec())
        .expect("sgr");
    let after_clicks = drain_text(&rx, 1200);
    println!(
        "PROMPT_REACTED_TO_CLICKS={} (len={})",
        !after_clicks.is_empty(),
        after_clicks.len()
    );
    let stray: String = after_clicks.chars().filter(|c| !c.is_control()).take(120).collect();
    println!("STRAY_RENDER: {stray:?}");

    // Shell still healthy? echo should round-trip cleanly.
    attachment.input(b"echo HEALTH_OK_$((6*7))\n".to_vec()).expect("echo");
    let echoed = drain_text(&rx, 1500);
    println!("SHELL_HEALTHY={}", echoed.contains("HEALTH_OK_42"));
    let vis: String = echoed.chars().filter(|c| !c.is_control()).take(200).collect();
    println!("ECHO_RENDER: {vis:?}");

    attachment.detach();
    let closed = api::request("local", "workspace.close", json!({"workspace_id": ws_id}));
    println!("== closed: {closed:?}");
}
