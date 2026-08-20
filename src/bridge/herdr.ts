// Typed bridge to the Rust core. Every UI action is one herdr API method;
// terminal bytes flow over per-pane Tauri channels and never touch app state.

import { Channel, invoke } from "@tauri-apps/api/core";

export type AgentStatus = "working" | "blocked" | "done" | "idle" | "unknown";

export interface PaneInfo {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd: string;
  agent?: string;
  agent_status: AgentStatus;
  terminal_title_stripped: string;
}

export interface WorkspaceInfo {
  workspace_id: string;
  label: string;
  number: number;
  focused: boolean;
  agent_status: AgentStatus;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
}

export interface TabInfo {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  agent_status: AgentStatus;
}

/** Per-tab layout summary from session.snapshot (cell-grid rects). */
export interface TabLayout {
  workspace_id: string;
  tab_id: string;
  zoomed: boolean;
  focused_pane_id: string;
}

/** BSP tree from layout.export — geometry and split addressing in one. */
export type LayoutNode =
  | { type: "pane"; pane_id: string; cwd: string }
  | {
      type: "split";
      direction: "right" | "down";
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };

export interface ServerInfo {
  version: string;
  protocol: number;
}

export interface SessionSnapshot {
  version: string;
  protocol: number;
  focused_workspace_id: string | null;
  focused_tab_id: string | null;
  focused_pane_id: string | null;
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  layouts: TabLayout[];
}

export type TermEvent =
  | { type: "connected"; seq_hint: number }
  | { type: "data"; b64: string; full: boolean; cols: number; rows: number }
  | { type: "title"; title: string }
  | { type: "mouse_capture"; enabled: boolean }
  | { type: "closed"; reason: string | null };

export async function apiRequest<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return invoke<T>("api_request", { method, params });
}

export const ping = () => apiRequest<ServerInfo>("ping");

export async function sessionSnapshot(): Promise<SessionSnapshot> {
  const result = await apiRequest<{ snapshot: SessionSnapshot }>("session.snapshot");
  return result.snapshot;
}

export async function layoutExport(tabId: string): Promise<{ root: LayoutNode; focused_pane_id: string }> {
  const result = await apiRequest<{ layout: { root: LayoutNode; focused_pane_id: string } }>(
    "layout.export",
    { tab_id: tabId },
  );
  return result.layout;
}

export const setSplitRatio = (tabId: string, path: string[], ratio: number) =>
  apiRequest("layout.set_split_ratio", { tab_id: tabId, path, ratio });

export const focusPane = (paneId: string) => apiRequest("pane.focus", { pane_id: paneId });
export const splitPane = (paneId: string, direction: "right" | "down") =>
  apiRequest("pane.split", { pane_id: paneId, direction });
export const closePane = (paneId: string) => apiRequest("pane.close", { pane_id: paneId });
export const zoomPane = (paneId: string) => apiRequest("pane.zoom", { pane_id: paneId });
export const createTab = (workspaceId: string) =>
  apiRequest<{ tab?: TabInfo; root_pane?: PaneInfo }>("tab.create", { workspace_id: workspaceId });
export const closeTab = (tabId: string) => apiRequest("tab.close", { tab_id: tabId });
export const focusTab = (tabId: string) => apiRequest("tab.focus", { tab_id: tabId });
export const moveTab = (tabId: string, insertIndex: number) =>
  apiRequest("tab.move", { tab_id: tabId, insert_index: insertIndex });
export const moveWorkspace = (workspaceId: string, insertIndex: number) =>
  apiRequest("workspace.move", { workspace_id: workspaceId, insert_index: insertIndex });
export const renameWorkspace = (workspaceId: string, label: string) =>
  apiRequest("workspace.rename", { workspace_id: workspaceId, label });
export const renameTab = (tabId: string, label: string) =>
  apiRequest("tab.rename", { tab_id: tabId, label });
export const closeWorkspace = (workspaceId: string) =>
  apiRequest("workspace.close", { workspace_id: workspaceId });
export const createWorkspace = (cwd: string) =>
  apiRequest<{ workspace?: WorkspaceInfo; root_pane?: PaneInfo }>("workspace.create", { cwd });

export function attachPane(
  attachId: string,
  target: string,
  cols: number,
  rows: number,
  onEvent: (event: TermEvent) => void,
): Promise<void> {
  const channel = new Channel<TermEvent>();
  channel.onmessage = onEvent;
  return invoke("attach_pane", { attachId, target, cols, rows, onEvent: channel });
}

export function paneInput(attachId: string, data: Uint8Array): Promise<void> {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return invoke("pane_input", { attachId, b64: btoa(binary) });
}

export const paneResize = (attachId: string, cols: number, rows: number) =>
  invoke<void>("pane_resize", { attachId, cols, rows });

export const paneScroll = (attachId: string, up: boolean, lines: number) =>
  invoke<void>("pane_scroll", { attachId, up, lines, column: null, row: null });

export const detachPane = (attachId: string) => invoke<void>("detach_pane", { attachId });

export function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
