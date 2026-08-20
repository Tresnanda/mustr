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
}

export interface ServerInfo {
  version: string;
  protocol: number;
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

export async function ping(): Promise<ServerInfo> {
  return apiRequest<ServerInfo>("ping");
}

export async function listPanes(): Promise<PaneInfo[]> {
  const result = await apiRequest<{ panes: PaneInfo[] }>("pane.list");
  return result.panes ?? [];
}

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  const result = await apiRequest<{ workspaces: WorkspaceInfo[] }>("workspace.list");
  return result.workspaces ?? [];
}

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

export function paneResize(attachId: string, cols: number, rows: number): Promise<void> {
  return invoke("pane_resize", { attachId, cols, rows });
}

export function paneScroll(attachId: string, up: boolean, lines: number): Promise<void> {
  return invoke("pane_scroll", { attachId, up, lines, column: null, row: null });
}

export function detachPane(attachId: string): Promise<void> {
  return invoke("detach_pane", { attachId });
}

export function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
