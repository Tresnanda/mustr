//! Live-server wire-generation test: verifies negotiation + attach against
//! whatever herdr binary `MUSTR_LIVE_BIN` points at (default: `herdr` on
//! PATH). Optional `MUSTR_LIVE_HOME` sandboxes the server's HOME so an
//! alternate version can run beside the installed one. Skipped unless
//! explicitly requested (`cargo test -- --ignored`); spawns a scratch
//! workspace and closes it afterwards.
//!
//! Coverage across generations: JSON ping reports the expected protocol,
//! `Codec` negotiates from it, Hello/Welcome handshake succeeds (the actual
//! v19/v20 skew lives in Hello's version field and launch_mode discriminant),
//! ControlTerminal attaches, terminal bytes stream back, and input round-trips.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::json;

use crate::protocol::{ClientMsg, Codec, Gen, ServerFrame};

struct ServerGuard(Child, PathBuf);

impl Drop for ServerGuard {
    fn drop(&mut self) {
        // Best-effort stop via the API socket, then kill.
        if let Ok(mut s) = std::os::unix::net::UnixStream::connect(self.1.join("herdr.sock")) {
            let _ = s.write_all(b"{\"id\":\"m\",\"method\":\"server.stop\",\"params\":{}}\n");
        }
        let _ = self.0.wait();
        let _ = std::fs::remove_dir_all(&self.1);
    }
}

fn spawn_server(bin: &str, home: &PathBuf) -> ServerGuard {
    let mut cmd = Command::new(bin);
    cmd.arg("--session").arg("livegen");
    cmd.env("HOME", home);
    // Running inside a herdr pane sets HERDR_* markers that make a child
    // herdr refuse to start ("nested herdr is disabled"); strip them.
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().starts_with("HERDR_") {
            cmd.env_remove(k);
        }
    }
    let child = cmd.spawn().expect("spawn herdr server");
    let dir = home.join(".config/herdr/sessions/livegen");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if Instant::now() > deadline {
        }
        if dir.join("herdr.sock").exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    ServerGuard(child, dir)
}

fn api_request(sock: &PathBuf, method: &str, params: serde_json::Value) -> serde_json::Value {
    let mut s = std::os::unix::net::UnixStream::connect(sock).expect("connect api");
    s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let req = json!({"id":"t","method":method,"params":params});
    s.write_all(format!("{req}\n").as_bytes()).unwrap();
    let line = BufReader::new(s).lines().next().unwrap().unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&line).unwrap();
    parsed.get("result").cloned().unwrap_or(serde_json::Value::Null)
}

fn drain(rx: &mpsc::Receiver<super::term::TermEvent>, ms: u64) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_millis(ms);
    let mut all = Vec::new();
    while let Ok(event) =
        rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
    {
        if let super::term::TermEvent::Data { b64, .. } = event {
            use base64::Engine as _;
            all.extend(base64::engine::general_purpose::STANDARD.decode(b64).unwrap());
        }
    }
    all
}

#[test]
#[ignore]
fn live_attach_negotiated_generation() {
    let bin = std::env::var("MUSTR_LIVE_BIN").unwrap_or_else(|_| "herdr".into());
    let home = std::env::var_os("MUSTR_LIVE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::var_os("HOME").unwrap().into());
    let guard = spawn_server(&bin, &home);
    let sock = guard.1.join("herdr.sock");

    // 1. Ping announces the protocol; Codec must negotiate from it.
    let ping = api_request(&sock, "ping", json!({}));
    let protocol = ping["protocol"].as_u64().expect("ping.protocol") as u32;
    let gen = Gen::from_server_protocol(protocol)
        .unwrap_or_else(|| panic!("server speaks unsupported protocol {protocol}"));
    eprintln!("server {bin} announced protocol {protocol}");
    let codec = Codec::new(gen);

    // 2. Full attach through the public facade types.
    let ws = api_request(&sock, "workspace.create", json!({"cwd": "/tmp"}));
    let pane_id = ws["root_pane"]["pane_id"].as_str().unwrap().to_owned();
    let ws_id = ws["workspace"]["workspace_id"].as_str().unwrap().to_owned();

    // Attach over the client socket using the same sequence as term.rs,
    // driven manually so this test exercises the codec, not Tauri plumbing.
    let mut stream =
        std::os::unix::net::UnixStream::connect(guard.1.join("herdr-client.sock")).unwrap();
    // Blocking reads must never outlive the test: poll with short timeouts
    // so the echo loop can re-check its deadline between frames.
    stream.set_read_timeout(Some(Duration::from_millis(250))).unwrap();
    codec
        .write(&mut stream, &ClientMsg::Hello { cols: 80, rows: 24 })
        .expect("hello write");
    match codec.read(&mut stream).expect("welcome read") {
        ServerFrame::Welcome { error: None, .. } => {}
        other => panic!("handshake failed: {other:?}"),
    }
    codec
        .write(
            &mut stream,
            &ClientMsg::ControlTerminal { target: pane_id.clone(), takeover: true },
        )
        .expect("control write");

    // 3. Bytes flow: give the fresh pane's shell a moment to come up, then
    // run echo inside it and observe the output.
    let mut warmup = Vec::new();
    let warm_deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < warm_deadline {
        match codec.read(&mut stream) {
            Ok(ServerFrame::Terminal(f)) => warmup.extend_from_slice(&f.bytes),
            Ok(_) | Err(_) => {}
        }
        if warmup.windows(2).any(|w| w == b"$ ") || warmup.windows(2).any(|w| w == b"% ")
        {
            break;
        }
    }
    codec.write(&mut stream, &ClientMsg::Input { data: b"echo LIVEGEN_OK\n".to_vec() }).unwrap();
    let mut out = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline && !out.windows(b"LIVEGEN_OK".len()).any(|w| w == b"LIVEGEN_OK") {
        match codec.read(&mut stream) {
            Ok(ServerFrame::Terminal(f)) => out.extend_from_slice(&f.bytes),
            // 250ms read timeout elapsed with no frame; loop re-checks deadline.
            Ok(_) | Err(_) => {}
        }
    }
    eprintln!(
        "warmup: {:?}\nout: {:?}",
        String::from_utf8_lossy(&warmup),
        String::from_utf8_lossy(&out)
    );
    assert!(
        out.windows(b"LIVEGEN_OK".len()).any(|w| w == b"LIVEGEN_OK"),
        "echo output not observed; got {} bytes",
        out.len()
    );

    // 4. Detach cleanly and close the scratch workspace.
    codec.write(&mut stream, &ClientMsg::Detach).unwrap();
    let _ = api_request(&sock, "workspace.close", json!({"workspace_id": ws_id}));
    drop(guard);

    // Silence unused warnings when only part of the harness runs.
    let _ = drain;
}
