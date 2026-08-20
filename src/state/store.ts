// Server-state mirror, snapshot-driven. The herdr server is the source of
// truth: one session.snapshot re-seeds everything on (re)connect and on
// debounced events; the selected tab's BSP tree is fetched alongside.
// Terminal bytes never pass through here.

import { create } from "zustand";
import {
  createTab,
  createWorkspace,
  focusPane,
  focusTab,
  layoutExport,
  ping,
  sessionSnapshot,
  type AgentStatus,
  type LayoutNode,
  type PaneInfo,
  type ServerInfo,
  type SessionSnapshot,
  type TabInfo,
  type TabLayout,
  type WorkspaceInfo,
} from "../bridge/herdr";
import { connectServer, listServers, type ServerRow } from "../bridge/servers";
import { notifyStatusChange } from "../bridge/notify";
import { paneDisplayName } from "../lib/names";

export const statusSince = new Map<string, number>();

interface MustrState {
  server: ServerInfo | null;
  serverError: string | null;
  connected: boolean;
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  layouts: TabLayout[];
  /** BSP tree of the selected tab. */
  tree: LayoutNode | null;
  selectedTabId: string | null;
  selectedPaneId: string | null;
  scopeId: string | null;
  filter: string;
  hideQuiet: boolean;
  hasLoaded: boolean;
  now: number;
  servers: ServerRow[];
  activeServerId: string;
  /** Server id currently connecting, for pending UI. */
  connectingId: string | null;
  connectError: string | null;
  refresh: () => Promise<void>;
  scheduleRefresh: () => void;
  setConnected: (connected: boolean) => void;
  selectPane: (paneId: string) => void;
  selectTab: (tabId: string) => void;
  setScope: (workspaceId: string | null) => void;
  setFilter: (filter: string) => void;
  toggleHideQuiet: () => void;
  newTerminal: () => Promise<void>;
  newSpace: (cwd: string) => Promise<void>;
  loadServers: () => Promise<void>;
  switchServer: (id: string) => Promise<void>;
  tick: () => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let lastStatus = new Map<string, AgentStatus>();

async function fetchTree(tabId: string | null): Promise<LayoutNode | null> {
  if (!tabId) return null;
  try {
    return (await layoutExport(tabId)).root;
  } catch {
    return null;
  }
}

function trackStatuses(snapshot: SessionSnapshot, hasLoaded: boolean) {
  const now = Date.now();
  for (const pane of snapshot.panes) {
    const prev = lastStatus.get(pane.pane_id);
    if (prev === undefined || prev !== pane.agent_status) {
      statusSince.set(pane.pane_id, now);
    }
    if (hasLoaded && prev && prev !== pane.agent_status) {
      notifyStatusChange(pane.agent_status, paneDisplayName(pane), pane.agent, pane.pane_id);
    }
  }
  lastStatus = new Map(snapshot.panes.map((p) => [p.pane_id, p.agent_status]));
}

export const useMustr = create<MustrState>((set, get) => ({
  server: null,
  serverError: null,
  connected: false,
  workspaces: [],
  tabs: [],
  panes: [],
  layouts: [],
  tree: null,
  selectedTabId: null,
  selectedPaneId: null,
  scopeId: null,
  filter: "",
  hideQuiet: false,
  hasLoaded: false,
  now: Date.now(),
  servers: [],
  activeServerId: "local",
  connectingId: null,
  connectError: null,

  refresh: async () => {
    try {
      const [server, snapshot] = await Promise.all([ping(), sessionSnapshot()]);
      trackStatuses(snapshot, get().hasLoaded);

      let { selectedTabId, selectedPaneId } = get();
      const paneExists = snapshot.panes.some((p) => p.pane_id === selectedPaneId);
      const tabExists = snapshot.tabs.some((t) => t.tab_id === selectedTabId);
      if (!selectedPaneId || !paneExists || !selectedTabId || !tabExists) {
        const focused =
          snapshot.panes.find((p) => p.pane_id === snapshot.focused_pane_id) ??
          snapshot.panes.find((p) => p.focused) ??
          snapshot.panes[0] ??
          null;
        selectedPaneId = focused?.pane_id ?? null;
        selectedTabId = focused?.tab_id ?? null;
      }

      const tree = await fetchTree(selectedTabId);
      set({
        server,
        workspaces: snapshot.workspaces,
        tabs: snapshot.tabs,
        panes: snapshot.panes,
        layouts: snapshot.layouts,
        tree,
        selectedTabId,
        selectedPaneId,
        serverError: null,
        hasLoaded: true,
      });
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

  selectPane: (paneId) => {
    const pane = get().panes.find((p) => p.pane_id === paneId);
    if (!pane) return;
    const tabChanged = pane.tab_id !== get().selectedTabId;
    set({ selectedPaneId: paneId, selectedTabId: pane.tab_id });
    void focusPane(paneId).catch(() => {});
    if (tabChanged) void fetchTree(pane.tab_id).then((tree) => set({ tree }));
  },

  selectTab: (tabId) => {
    const layout = get().layouts.find((l) => l.tab_id === tabId);
    const fallback = get().panes.find((p) => p.tab_id === tabId);
    const paneId = layout?.focused_pane_id ?? fallback?.pane_id ?? null;
    set({ selectedTabId: tabId, selectedPaneId: paneId });
    void focusTab(tabId).catch(() => {});
    void fetchTree(tabId).then((tree) => set({ tree }));
  },

  setScope: (workspaceId) => set({ scopeId: workspaceId }),
  setFilter: (filter) => set({ filter }),
  toggleHideQuiet: () => set((st) => ({ hideQuiet: !st.hideQuiet })),
  tick: () => set({ now: Date.now() }),

  loadServers: async () => {
    try {
      const servers = await listServers();
      const active = servers.find((s) => s.active);
      set({ servers, activeServerId: active?.id ?? "local" });
    } catch {
      // registry unavailable: keep whatever we had
    }
  },

  switchServer: async (id) => {
    if (get().connectingId || id === get().activeServerId) return;
    set({ connectingId: id, connectError: null });
    try {
      await connectServer(id);
      // New server, new world: drop the mirror and re-seed.
      lastStatus = new Map();
      statusSince.clear();
      set({
        activeServerId: id,
        workspaces: [],
        tabs: [],
        panes: [],
        layouts: [],
        tree: null,
        selectedTabId: null,
        selectedPaneId: null,
        scopeId: null,
        hasLoaded: false,
      });
      await get().refresh();
      await get().loadServers();
    } catch (error) {
      set({ connectError: String(error) });
    } finally {
      set({ connectingId: null });
    }
  },

  newTerminal: async () => {
    const { scopeId, workspaces, panes, selectedPaneId } = get();
    const selected = panes.find((p) => p.pane_id === selectedPaneId);
    const workspaceId =
      scopeId ??
      selected?.workspace_id ??
      workspaces.find((w) => w.focused)?.workspace_id ??
      workspaces[0]?.workspace_id;
    if (!workspaceId) return;
    const result = await createTab(workspaceId);
    if (result.root_pane && result.tab) {
      set({ selectedPaneId: result.root_pane.pane_id, selectedTabId: result.tab.tab_id });
    }
    await get().refresh();
  },

  newSpace: async (cwd) => {
    const result = await createWorkspace(cwd);
    if (result.workspace) set({ scopeId: result.workspace.workspace_id });
    if (result.root_pane) {
      set({
        selectedPaneId: result.root_pane.pane_id,
        selectedTabId: result.root_pane.tab_id,
      });
    }
    await get().refresh();
  },
}));
