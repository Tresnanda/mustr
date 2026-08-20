//! Local git summaries for sidebar rows: branch + dirty, batch-queried.
//! Only meaningful for the Local server — remote cwds are on the remote.

use std::collections::HashMap;
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct GitSummary {
    pub branch: String,
    pub dirty: bool,
}

pub fn summaries(cwds: Vec<String>) -> HashMap<String, GitSummary> {
    let mut out = HashMap::new();
    for cwd in cwds {
        let branch = Command::new("git")
            .args(["-C", &cwd, "rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned());
        let Some(branch) = branch.filter(|b| !b.is_empty()) else {
            continue;
        };
        let dirty = Command::new("git")
            .args(["-C", &cwd, "status", "--porcelain", "--untracked-files=no"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| !o.stdout.is_empty())
            .unwrap_or(false);
        out.insert(cwd, GitSummary { branch, dirty });
    }
    out
}
