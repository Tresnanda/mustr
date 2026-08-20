// Server-state mirror. The herdr server is the source of truth: re-seeded on
// every (re)connect, refreshed (debounced) on events. Terminal bytes never pass here.

import { create } from "zustand";
import {
  apiRequest,
  listPanes,
  listWorkspaces,
  ping,
  type AgentStatus,
  type PaneInfo,
  type ServerInfo,
  type WorkspaceInfo,
} from "../bridge/herdr";
import { notifyStatusChange } from "../bridge/notify";
import { paneDisplayName } from "../lib/names";

export const statusSince = new Map<string, number>();

interface MustrState {
  server: ServerInfo | null;
  serverError: string | null;
  connected: boolean;
  workspaces: WorkspaceInfo[];
  panes: PaneInfo[];
  selectedPaneId: string | null;
  /** Sidebar scope: a workspace_id, or null for all spaces. */
  scopeId: string | null;
  filter: string;
  hasLoaded: boolean;
  /** Coarse clock (30s) so relative times re-render. */
  now: number;
  refresh: () => Promise<void>;
  scheduleRefresh: () => void;
  setConnected: (connected: boolean) => void;
  selectPane: (paneId: string) => void;
  setScope: (workspaceId: string | null) => void;
  setFilter: (filter: string) => void;
  newTerminal: () => Promise<void>;
  newSpace: (cwd: string) => Promise<void>;
  hideQuiet: boolean;
  toggleHideQuiet: () => void;
  tick: () => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let lastStatus = new Map<string, AgentStatus>();

export const useMustr = create<MustrState>((set, get) => ({
  server: null,
  serverError: null,
  connected: false,
  workspaces: [],
  panes: [],
  selectedPaneId: null,
  scopeId: null,
  filter: "",
  hasLoaded: false,
  now: Date.now(),
  hideQuiet: false,

  refresh: async () => {
    try {
      const [server, workspaces, panes] = await Promise.all([
        ping(),
        listWorkspaces(),
        listPanes(),
      ]);

      const now = Date.now();
      for (const pane of panes) {
        const prev = lastStatus.get(pane.pane_id);
        if (prev === undefined || prev !== pane.agent_status) {
          statusSince.set(pane.pane_id, now);
        }
        if (get().hasLoaded && prev && prev !== pane.agent_status) {
          notifyStatusChange(pane.agent_status, paneDisplayName(pane), pane.agent);
        }
      }
      lastStatus = new Map(panes.map((p) => [p.pane_id, p.agent_status]));

      set({ server, workspaces, panes, serverError: null, hasLoaded: true });

      const { selectedPaneId } = get();
      if (!selectedPaneId || !panes.some((p) => p.pane_id === selectedPaneId)) {
        const focused = panes.find((p) => p.focused) ?? panes[0] ?? null;
        set({ selectedPaneId: focused?.pane_id ?? null });
      }
    } catch (error) {
      set({ server: null, serverError: String(error) });
    }
  },

  scheduleRefresh: () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void get().refresh();
    }, 150);
  },

  setConnected: (connected) => {
    set({ connected });
    if (connected) void get().refresh();
  },

  selectPane: (paneId) => set({ selectedPaneId: paneId }),
  tick: () => set({ now: Date.now() }),
  toggleHideQuiet: () => set((st) => ({ hideQuiet: !st.hideQuiet })),

  newSpace: async (cwd) => {
    const result = await apiRequest<{
      workspace?: { workspace_id: string };
      root_pane?: { pane_id: string };
    }>("workspace.create", { cwd });
    if (result.workspace) set({ scopeId: result.workspace.workspace_id });
    if (result.root_pane?.pane_id) set({ selectedPaneId: result.root_pane.pane_id });
    await get().refresh();
  },
  setScope: (workspaceId) => set({ scopeId: workspaceId }),
  setFilter: (filter) => set({ filter }),

  newTerminal: async () => {
    const { scopeId, workspaces, panes, selectedPaneId } = get();
    const selected = panes.find((p) => p.pane_id === selectedPaneId);
    const workspaceId =
      scopeId ??
      selected?.workspace_id ??
      workspaces.find((w) => w.focused)?.workspace_id ??
      workspaces[0]?.workspace_id;
    if (!workspaceId) return;
    const result = await apiRequest<{ root_pane?: { pane_id: string } }>("tab.create", {
      workspace_id: workspaceId,
    });
    if (result.root_pane?.pane_id) set({ selectedPaneId: result.root_pane.pane_id });
    await get().refresh();
  },
}));
