// Display-name rules (information over decoration): agent panes are named by
// their product; shell panes by their folder. Raw "user@host" titles never ship.

import type { PaneInfo } from "../bridge/herdr";

// Leading spinner/status glyphs herdr agents put in titles.
const LEADING_GLYPHS = /^[\s⠀-⣿◐-◓✱⚙●○✦✧✳✶✻·•*]+/;

const AGENT_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  cursor: "Cursor",
  opencode: "OpenCode",
  copilot: "GitHub Copilot",
  grok: "Grok",
  amp: "Amp",
  droid: "Droid",
  kimi: "Kimi",
  kiro: "Kiro",
  devin: "Devin",
  cline: "Cline",
  qwen: "Qwen Code",
};

export function prettyAgent(agent: string): string {
  return AGENT_NAMES[agent] ?? agent.charAt(0).toUpperCase() + agent.slice(1);
}

export function cwdFolder(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const home = cwd.replace(/\/+$/, "");
  const parts = home.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (parts.length === 2 && parts[0] === "Users") return "~";
  return parts[parts.length - 1];
}

/** Title with spinner glyphs stripped; null if it's a useless shell title. */
export function cleanTitle(pane: PaneInfo): string | null {
  const title = (pane.terminal_title_stripped ?? "").replace(LEADING_GLYPHS, "").trim();
  if (!title || title.includes("@")) return null;
  return title;
}

/** Primary label: agent product name, or the folder for plain shells. */
export function paneDisplayName(pane: PaneInfo): string {
  if (pane.agent) return prettyAgent(pane.agent);
  return cwdFolder(pane.cwd) ?? pane.pane_id;
}

/** Secondary label for agent cards: what the agent is doing, or its folder. */
export function paneDetail(pane: PaneInfo): string {
  const title = cleanTitle(pane);
  const folder = cwdFolder(pane.cwd);
  if (pane.agent && title && title.toLowerCase() !== prettyAgent(pane.agent).toLowerCase()) {
    return title;
  }
  return folder ?? pane.pane_id;
}
