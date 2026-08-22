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
  setBridgeServer,
  windowServerId,
  type AgentStatus,
  type LayoutNode,
  type PaneInfo,
  type ServerInfo,
  type SessionSnapshot,
  type TabInfo,
  type TabLayout,
  type WorkspaceInfo,
} from "../bridge/herdr";
import { connectServer, gitSummaries, listServers, type GitSummary, type ServerRow } from "../bridge/servers";
import { notifyStatusChange } from "../bridge/notify";
import { paneDisplayName } from "../lib/names";

export const statusSince = new Map<string, number>();

export type AgentGroupBy = "status" | "space";
export type AgentOrder = "attention" | "recent" | "name";
export type AgentShow = "all" | "active" | "hide-idle" | "hide-done";

const AGENT_STATUSES: AgentStatus[] = ["blocked", "working", "done", "idle"];

function readPref<T>(key: string, fallback: T, ok: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v: unknown = JSON.parse(raw);
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function isGroupBy(v: unknown): v is AgentGroupBy {
  return v === "status" || v === "space";
}
function isOrder(v: unknown): v is AgentOrder {
  return v === "attention" || v === "recent" || v === "name";
}
function isShow(v: unknown): v is AgentShow {
  return v === "all" || v === "active" || v === "hide-idle" || v === "hide-done";
}
function isStatusList(v: unknown): v is AgentStatus[] | null {
  if (v === null) return true;
  return Array.isArray(v) && v.every((s) => AGENT_STATUSES.includes(s as AgentStatus));
}
function isNameList(v: unknown): v is string[] | null {
  if (v === null) return true;
  return Array.isArray(v) && v.every((s) => typeof s === "string");
}

interface MustrState {
  server: ServerInfo | null;
  serverError: string | null;
  connected: boolean;
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  layouts: TabLayout[];
  /** BSP trees per tab (cache; selected tab kept fresh). */
  trees: Record<string, LayoutNode>;
  /** Recently viewed tabs, kept mounted for instant switching (LRU). */
  visitedTabs: string[];
  selectedTabId: string | null;
  selectedPaneId: string | null;
  scopeId: string | null;
  filter: string;
  agentGroupBy: AgentGroupBy;
  agentOrder: AgentOrder;
  agentShow: AgentShow;
  /** null = every status. Empty = match none. */
  agentStatuses: AgentStatus[] | null;
  /** null = every agent name. Empty = match none. */
  agentNames: string[] | null;
  hasLoaded: boolean;
  now: number;
  termFontSize: number;
  findOpen: boolean;
  notifyBlocked: boolean;
  notifyDone: boolean;
  appearance: "glass" | "solid";
  /** Chord (e.g. "ctrl+v") that bridges a local clipboard image into a
      remote (SSH) session; empty = disabled. See lib/keychord. */
  remoteImagePasteKey: string;
  setTermFontSize: (px: number) => void;
  setFindOpen: (open: boolean) => void;
  setNotifyPref: (kind: "blocked" | "done", on: boolean) => void;
  setAppearance: (a: "glass" | "solid") => void;
  setRemoteImagePasteKey: (chord: string) => void;
  servers: ServerRow[];
  activeServerId: string;
  /** Server id currently connecting, for pending UI. */
  connectingId: string | null;
  connectError: string | null;
  /** cwd → branch/dirty, local server only. */
  git: Record<string, GitSummary>;
  refresh: () => Promise<void>;
  scheduleRefresh: () => void;
  /** Merge one pushed pane row (herdr pane.updated) into the mirror. */
  applyPaneUpdate: (pane: PaneInfo) => void;
  /** Merge a pushed delta from the backend git watcher; `removed` cwds
      (vanished repos) are dropped from the map. */
  mergeGit: (summaries: Record<string, GitSummary>, removed?: string[]) => void;
  /** Window became visible again; flush deferred refreshes. */
  onVisible: () => void;
  setConnected: (connected: boolean) => void;
  selectPane: (paneId: string) => void;
  selectTab: (tabId: string) => void;
  setScope: (workspaceId: string | null) => void;
  setFilter: (filter: string) => void;
  setAgentGroupBy: (by: AgentGroupBy) => void;
  setAgentOrder: (order: AgentOrder) => void;
  setAgentShow: (show: AgentShow) => void;
  toggleAgentStatus: (status: AgentStatus) => void;
  toggleAgentName: (name: string, all: string[]) => void;
  resetAgentView: () => void;
  newTerminal: () => Promise<void>;
  newSpace: (cwd: string) => Promise<void>;
  loadServers: () => Promise<void>;
  switchServer: (id: string) => Promise<void>;
  tick: () => void;
  reconcileIfStale: () => void;
  /** A pane's mouse capture crossed its agent flag — an agent likely just
      started (capture on, not yet an agent) or exited (capture off, still an
      agent). Pull a fresh snapshot to sync the sidebar. */
  reconcileAgentBoundary: () => void;
}

const WARM_TABS = 4;

function touchVisited(visited: string[], tabId: string | null): string[] {
  if (!tabId) return visited;
  return [tabId, ...visited.filter((t) => t !== tabId)].slice(0, WARM_TABS);
}

let refreshTimer: number | null = null;
let lastStatus = new Map<string, AgentStatus>();
let lastGitCwds: string[] | null = null;

// Status drift self-heal (see reconcileIfStale): a pane still "working" this
// long after its last change is treated as a dropped resting-state push.
const STALE_STATUS_MS = 15_000;
const STALE_RECONCILE_MIN_GAP_MS = 20_000;
let lastStaleReconcile = 0;

// Agent-boundary self-heal (see reconcileAgentBoundary): herdr recomputes a
// pane's agent classification lazily and doesn't push the set/cleared row to
// attach clients when an agent starts or exits — only the mouse-capture
// transition that comes with it (agents turn mouse reporting on at startup,
// off on exit). Pull one snapshot to sync the sidebar at once, rate-limited
// so ordinary capture toggles (a menu, or a non-agent mouse app like vim)
// can't spam snapshots.
const AGENT_BOUNDARY_RECONCILE_MIN_GAP_MS = 4_000;
let lastAgentBoundaryReconcile = 0;

/** Local only: fetch the backend git cache when the set of pane cwds
    changes. The backend keeps entries fresh via FSEvents pushes
    (`herdr-git`); nothing here runs on a timer. */
function maybeFetchGit(panes: PaneInfo[], activeServerId: string) {
  if (activeServerId !== "local") return;
  const cwds = [...new Set(panes.map((p) => p.cwd).filter(Boolean))].sort();
  const prev = lastGitCwds;
  if (prev && prev.length === cwds.length && prev.every((c, i) => c === cwds[i])) return;
  lastGitCwds = cwds;
  void gitSummaries(cwds)
    .then((git) => useMustr.setState({ git }))
    .catch(() => {});
}

async function fetchTree(tabId: string | null): Promise<LayoutNode | null> {
  if (!tabId) return null;
  try {
    return (await layoutExport(tabId)).root;
  } catch {
    return null;
  }
}

/** Status transitions for one pane: timestamp them, and fire the
    blocked/done notification when wanted. Shared by the snapshot path
    and the pushed pane.updated path so notifications behave identically. */
function trackPaneStatus(pane: PaneInfo, hasLoaded: boolean) {
  const now = Date.now();
  const prev = lastStatus.get(pane.pane_id);
  if (prev === undefined || prev !== pane.agent_status) {
    statusSince.set(pane.pane_id, now);
  }
  if (hasLoaded && prev && prev !== pane.agent_status) {
    const st = useMustr.getState();
    const wanted =
      (pane.agent_status === "blocked" && st.notifyBlocked) ||
      (pane.agent_status === "done" && st.notifyDone);
    if (wanted) {
      notifyStatusChange(pane.agent_status, paneDisplayName(pane), pane.agent, pane.pane_id);
    }
  }
  lastStatus.set(pane.pane_id, pane.agent_status);
}

// Coalesce sub-second agent_status flaps. herdr can toggle a pane
// working↔idle between quick tool calls; with the status-ordered agent list
// that re-sorts the rows (visible thrash) and flashes the working spinner for
// blips that aren't real activity. A new status only becomes visible once it
// has held for STATUS_SETTLE_MS; a status that reverts before then is dropped.
// First sighting of a pane commits immediately. Icon, sort, statusSince and
// notifications all follow the settled value, so they stay consistent.
const STATUS_SETTLE_MS = 500;
const shownStatus = new Map<string, AgentStatus>();
const pendingStatus = new Map<string, { target: AgentStatus; timer: number }>();

function clearStatusSmoothing() {
  for (const { timer } of pendingStatus.values()) clearTimeout(timer);
  pendingStatus.clear();
  shownStatus.clear();
}

/** The status to display for a pane now; schedules a deferred commit when a
    real change settles. */
function settleStatus(paneId: string, raw: AgentStatus): AgentStatus {
  const shown = shownStatus.get(paneId);
  if (shown === undefined) {
    shownStatus.set(paneId, raw);
    return raw;
  }
  const pending = pendingStatus.get(paneId);
  if (raw === shown) {
    // Settled back before the window closed — the flap never happened.
    if (pending) {
      clearTimeout(pending.timer);
      pendingStatus.delete(paneId);
    }
    return shown;
  }
  if (pending?.target === raw) return shown; // already waiting on this target
  if (pending) clearTimeout(pending.timer);
  const timer = window.setTimeout(() => {
    pendingStatus.delete(paneId);
    shownStatus.set(paneId, raw);
    commitSettledStatus(paneId, raw);
  }, STATUS_SETTLE_MS);
  pendingStatus.set(paneId, { target: raw, timer });
  return shown;
}

/** Returns pane with its displayed (settled) status, running the same
    per-pane tracking the immediate paths use. */
function withSettledStatus(pane: PaneInfo, hasLoaded: boolean): PaneInfo {
  const settled = settleStatus(pane.pane_id, pane.agent_status);
  const spane = settled === pane.agent_status ? pane : { ...pane, agent_status: settled };
  trackPaneStatus(spane, hasLoaded);
  return spane;
}

/** Push a settled status into state so the icon and sort update once the flap
    window has closed. */
function commitSettledStatus(paneId: string, status: AgentStatus) {
  const st = useMustr.getState();
  const idx = st.panes.findIndex((p) => p.pane_id === paneId);
  if (idx < 0) return;
  const pane = { ...st.panes[idx], agent_status: status };
  trackPaneStatus(pane, st.hasLoaded);
  useMustr.setState({ panes: st.panes.map((p, i) => (i === idx ? pane : p)) });
  st.scheduleRefresh();
}

/** Settle every pane in a snapshot; returns the panes to store. */
function trackStatuses(snapshot: SessionSnapshot, hasLoaded: boolean): PaneInfo[] {
  return snapshot.panes.map((pane) => withSettledStatus(pane, hasLoaded));
}

export const useMustr = create<MustrState>((set, get) => ({
  server: null,
  serverError: null,
  connected: false,
  workspaces: [],
  tabs: [],
  panes: [],
  layouts: [],
  trees: {},
  visitedTabs: [],
  selectedTabId: null,
  selectedPaneId: null,
  scopeId: null,
  filter: "",
  agentGroupBy: readPref("mustr:agentGroupBy", "status", isGroupBy),
  agentOrder: readPref("mustr:agentOrder", "attention", isOrder),
  agentShow: readPref("mustr:agentShow", "all", isShow),
  agentStatuses: readPref("mustr:agentStatuses", null, isStatusList),
  agentNames: readPref("mustr:agentNames", null, isNameList),
  hasLoaded: false,
  now: Date.now(),
  termFontSize: Number(localStorage.getItem("mustr:termFontSize")) || 13,
  findOpen: false,
  notifyBlocked: localStorage.getItem("mustr:notifyBlocked") !== "off",
  notifyDone: localStorage.getItem("mustr:notifyDone") !== "off",
  appearance: (localStorage.getItem("mustr:appearance") as "glass" | "solid") || "glass",
  remoteImagePasteKey: localStorage.getItem("mustr:remoteImagePasteKey") ?? "ctrl+v",
  setRemoteImagePasteKey: (chord) => {
    localStorage.setItem("mustr:remoteImagePasteKey", chord);
    set({ remoteImagePasteKey: chord });
  },
  setNotifyPref: (kind, on) => {
    localStorage.setItem(kind === "blocked" ? "mustr:notifyBlocked" : "mustr:notifyDone", on ? "on" : "off");
    set(kind === "blocked" ? { notifyBlocked: on } : { notifyDone: on });
  },
  setAppearance: (appearance) => {
    localStorage.setItem("mustr:appearance", appearance);
    document.documentElement.classList.add("theme-switching");
    document.documentElement.dataset.appearance = appearance;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove("theme-switching");
      });
    });
    set({ appearance });
  },
  setTermFontSize: (px) => {
    const clamped = Math.min(22, Math.max(10, px));
    localStorage.setItem("mustr:termFontSize", String(clamped));
    set({ termFontSize: clamped });
  },
  setFindOpen: (findOpen) => set({ findOpen }),
  servers: [],
  // Per-host windows boot bound to the server in their URL.
  activeServerId: windowServerId(),
  connectingId: null,
  connectError: null,
  git: {},

  refresh: async () => {
    try {
      // Each request is its own connection + round trip over an SSH
      // tunnel on remote hosts (the api server closes after one request),
      // so overlap everything: ping only until known, and fetch the
      // current tab's tree alongside the snapshot instead of after it.
      const selectedBefore = get().selectedTabId;
      const [server, snapshot, treeBefore] = await Promise.all([
        get().server ?? ping(),
        sessionSnapshot(),
        fetchTree(selectedBefore),
      ]);
      const settledPanes = trackStatuses(snapshot, get().hasLoaded);

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

      // Git summaries: local only, refetched when the cwd set changes.
      maybeFetchGit(snapshot.panes, get().activeServerId);

      // The parallel fetch covers the common case; re-fetch only when the
      // snapshot moved selection to a different tab.
      const tree =
        selectedTabId === selectedBefore ? treeBefore : await fetchTree(selectedTabId);
      set((st) => ({
        server,
        workspaces: snapshot.workspaces,
        tabs: snapshot.tabs,
        panes: settledPanes,
        layouts: snapshot.layouts,
        trees:
          tree && selectedTabId ? { ...st.trees, [selectedTabId]: tree } : st.trees,
        visitedTabs: touchVisited(st.visitedTabs, selectedTabId),
        selectedTabId,
        selectedPaneId,
        serverError: null,
        hasLoaded: true,
      }));
    } catch (error) {
      set({ server: null, serverError: String(error) });
    }
  },

  scheduleRefresh: () => {
    // Hidden windows skip structural refreshes entirely; onVisible re-seeds
    // in full on restore, so there's nothing to defer.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    if (refreshTimer != null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void get().refresh();
    }, 150);
  },

  applyPaneUpdate: (pane) => {
    const st = get();
    // Show the settled status, not the raw flap (see settleStatus).
    const settled = settleStatus(pane.pane_id, pane.agent_status);
    const spane = settled === pane.agent_status ? pane : { ...pane, agent_status: settled };
    const idx = st.panes.findIndex((p) => p.pane_id === spane.pane_id);
    const prev = idx >= 0 ? st.panes[idx] : undefined;
    // Spinner-title churn bumps the row constantly; merge only when a
    // field the UI actually shows moved.
    if (
      prev &&
      prev.tab_id === spane.tab_id &&
      prev.workspace_id === spane.workspace_id &&
      prev.focused === spane.focused &&
      prev.agent_status === spane.agent_status &&
      prev.cwd === spane.cwd &&
      prev.agent === spane.agent &&
      prev.terminal_title_stripped === spane.terminal_title_stripped
    ) {
      return;
    }
    trackPaneStatus(spane, st.hasLoaded);
    const panes =
      idx >= 0
        ? // pane.updated is the full authoritative row: when an agent exits,
          // the server drops the optional `agent` field entirely, so a plain
          // spread can't unset a stale `prev.agent` ("claude"). Force `agent`
          // from the incoming row so the pane flips back to a terminal at once
          // — otherwise the sidebar keeps listing it and mouse-reporting stays
          // on, echoing click coordinates into the dead shell.
          st.panes.map((p, i) => (i === idx ? { ...prev, ...spane, agent: spane.agent } : p))
        : [...st.panes, spane];
    set({ panes });
    maybeFetchGit(panes, st.activeServerId);
    // Workspace rollups and trees come only from snapshots; refresh for
    // real when an agent changes state (rare vs title churn).
    if (!prev || prev.agent_status !== spane.agent_status) get().scheduleRefresh();
  },

  mergeGit: (summaries, removed = []) =>
    set((st) => {
      const git = { ...st.git, ...summaries };
      for (const cwd of removed) delete git[cwd];
      return { git };
    }),

  onVisible: () => {
    // A hidden window skips the 120s reconcile and defers structural
    // refreshes; on restore always re-seed so state that aged out while
    // minimized snaps back within one beat, queued event or not.
    void get().refresh();
  },

  setConnected: (connected) => {
    set({ connected });
    if (connected) void get().refresh();
  },

  selectPane: (paneId) => {
    const pane = get().panes.find((p) => p.pane_id === paneId);
    if (!pane) return;
    set((st) => ({
      selectedPaneId: paneId,
      selectedTabId: pane.tab_id,
      visitedTabs: touchVisited(st.visitedTabs, pane.tab_id),
    }));
    void focusPane(paneId).catch(() => {});
    void fetchTree(pane.tab_id).then((tree) => {
      if (tree) set((st) => ({ trees: { ...st.trees, [pane.tab_id]: tree } }));
    });
  },

  selectTab: (tabId) => {
    const layout = get().layouts.find((l) => l.tab_id === tabId);
    const fallback = get().panes.find((p) => p.tab_id === tabId);
    const paneId = layout?.focused_pane_id ?? fallback?.pane_id ?? null;
    set((st) => ({
      selectedTabId: tabId,
      selectedPaneId: paneId,
      visitedTabs: touchVisited(st.visitedTabs, tabId),
    }));
    void focusTab(tabId).catch(() => {});
    void fetchTree(tabId).then((tree) => {
      if (tree) set((st) => ({ trees: { ...st.trees, [tabId]: tree } }));
    });
  },

  setScope: (workspaceId) => set({ scopeId: workspaceId }),
  setFilter: (filter) => set({ filter }),
  setAgentGroupBy: (agentGroupBy) => {
    localStorage.setItem("mustr:agentGroupBy", JSON.stringify(agentGroupBy));
    set({ agentGroupBy });
  },
  setAgentOrder: (agentOrder) => {
    localStorage.setItem("mustr:agentOrder", JSON.stringify(agentOrder));
    set({ agentOrder });
  },
  setAgentShow: (agentShow) => {
    localStorage.setItem("mustr:agentShow", JSON.stringify(agentShow));
    set({ agentShow });
  },
  toggleAgentStatus: (status) => {
    const current = get().agentStatuses ?? AGENT_STATUSES;
    const next = current.includes(status) ? current.filter((s) => s !== status) : [...current, status];
    const agentStatuses = next.length === AGENT_STATUSES.length ? null : next;
    localStorage.setItem("mustr:agentStatuses", JSON.stringify(agentStatuses));
    set({ agentStatuses });
  },
  toggleAgentName: (name, all) => {
    const current = get().agentNames ?? all;
    const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
    const agentNames = next.length === all.length ? null : next;
    localStorage.setItem("mustr:agentNames", JSON.stringify(agentNames));
    set({ agentNames });
  },
  resetAgentView: () => {
    localStorage.removeItem("mustr:agentGroupBy");
    localStorage.removeItem("mustr:agentOrder");
    localStorage.removeItem("mustr:agentShow");
    localStorage.removeItem("mustr:agentStatuses");
    localStorage.removeItem("mustr:agentNames");
    set({
      agentGroupBy: "status",
      agentOrder: "attention",
      agentShow: "all",
      agentStatuses: null,
      agentNames: null,
    });
  },
  tick: () => set({ now: Date.now() }),

  // Drift self-heal for status specifically. A working/blocked pane gets
  // frequent pushes; if one has sat unchanged well past when it should have
  // moved, herdr likely dropped the resting-state push to this attach client
  // (they don't get every signal — see protocol-notes). Reconcile once to
  // catch it, rate-limited so a genuinely long task doesn't spam snapshots.
  // Idle apps have no working panes, so this never fires when truly idle.
  reconcileIfStale: () => {
    const st = get();
    const now = Date.now();
    if (now - lastStaleReconcile < STALE_RECONCILE_MIN_GAP_MS) return;
    const stale = st.panes.some(
      (p) =>
        (p.agent_status === "working" || p.agent_status === "blocked") &&
        now - (statusSince.get(p.pane_id) ?? now) > STALE_STATUS_MS,
    );
    if (stale) {
      lastStaleReconcile = now;
      void st.refresh();
    }
  },

  // Called when a pane's mouse capture crosses its agent flag — the signature
  // of an agent starting or exiting. herdr recomputes the classification on
  // pull (snapshot) but doesn't push the transition here, so one rate-limited
  // refresh syncs the sidebar in <1s instead of waiting for reconcileIfStale's
  // ~15s window. Event-driven, not a poll, and a no-op merge when nothing
  // actually changed.
  reconcileAgentBoundary: () => {
    const now = Date.now();
    if (now - lastAgentBoundaryReconcile < AGENT_BOUNDARY_RECONCILE_MIN_GAP_MS) return;
    lastAgentBoundaryReconcile = now;
    void get().refresh();
  },

  loadServers: async () => {
    try {
      const servers = await listServers();
      set({ servers });
    } catch {
      // registry unavailable: keep whatever we had
    }
  },

  switchServer: async (id) => {
    if (get().connectingId || id === get().activeServerId) return;
    set({ connectingId: id, connectError: null });
    try {
      // Ensure a pooled connection, then retarget only this window —
      // other windows and their connections stay live.
      await connectServer(id);
      setBridgeServer(id);
      // New server, new world: drop the mirror and re-seed.
      lastStatus = new Map();
      statusSince.clear();
      clearStatusSmoothing();
      set({
        activeServerId: id,
        server: null,
        workspaces: [],
        tabs: [],
        panes: [],
        layouts: [],
        trees: {},
        visitedTabs: [],
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
