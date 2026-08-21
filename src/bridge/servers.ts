// Server registry bridge: Local plus saved SSH quickies.

import { invoke } from "@tauri-apps/api/core";

export interface ServerRow {
  id: string;
  name: string;
  detail: string;
  kind: "local" | "ssh";
  /** A live pool connection exists (shared by all windows). Which server
      this window is on lives in the store's activeServerId. */
  connected: boolean;
}

export const listServers = () => invoke<ServerRow[]>("servers_list");
export const addServer = (name: string, host: string) =>
  invoke<ServerRow[]>("server_add", { name, host });
export const removeServer = (id: string) => invoke<ServerRow[]>("server_remove", { id });
export const connectServer = (id: string) => invoke<string>("server_connect", { id });
export const disconnectServer = (id: string) => invoke<ServerRow[]>("server_disconnect", { id });
export const openHostWindow = (id: string) => invoke<void>("open_host_window", { id });
export const sshAliases = () => invoke<string[]>("ssh_aliases");

export interface GitSummary {
  branch: string;
  dirty: boolean;
}
export const gitSummaries = (cwds: string[]) =>
  invoke<Record<string, GitSummary>>("git_summaries", { cwds });
