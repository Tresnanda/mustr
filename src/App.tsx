import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/sidebar/Sidebar";
import { STATUS_LABEL } from "./components/status";
import { PaneGrid } from "./components/panes/PaneGrid";
import { TabStrip } from "./components/tabs/TabStrip";
import { dragHandlers } from "./components/DragRegion";
import { TipProvider } from "./components/ui/Tip";
import { Navigator } from "./components/command/Navigator";
import { Toasts } from "./components/feedback/Toasts";
import { ClosePaneDialog } from "./components/panes/ClosePaneDialog";
import { statusSince, useMustr } from "./state/store";
import { lastNotified } from "./bridge/notify";
import { connectServer } from "./bridge/servers";
import { splitPane, zoomPane, focusPane } from "./bridge/herdr";
import { openUrl } from "@tauri-apps/plugin-opener";
import { paneDisplayName } from "./lib/names";
import { relativeAge } from "./lib/time";

/** Toolbar: pane name + space on the left, quiet status text on the right.
    It is also the window drag surface. */
function Toolbar() {
  const { panes, workspaces, selectedPaneId, now } = useMustr();
  const pane = panes.find((p) => p.pane_id === selectedPaneId) ?? null;
  const space = pane && workspaces.find((w) => w.workspace_id === pane.workspace_id)?.label;
  const age = pane ? relativeAge(statusSince.get(pane.pane_id), now) : "";
  const showStatus = pane && pane.agent_status !== "unknown";

  return (
    <header
      {...dragHandlers()}
      className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border-subtle px-4"
    >
      {pane && (
        <>
          <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-text-primary">
            {paneDisplayName(pane)}
          </span>
          {space && space !== paneDisplayName(pane) && (
            <span className="truncate text-[12px] text-text-muted">{space}</span>
          )}
          <span className="flex-1" />
          {showStatus && (
            <span
              className={`shrink-0 text-[12px] tabular-nums ${
                pane.agent_status === "blocked" ? "font-medium text-status-blocked" : "text-text-muted"
              }`}
            >
              {STATUS_LABEL[pane.agent_status]}
              {age ? ` · ${age}` : ""}
            </span>
          )}
        </>
      )}
      {!pane && <span className="flex-1" />}
    </header>
  );
}

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [closingPaneId, setClosingPaneId] = useState<string | null>(null);
  const {
    selectedPaneId,
    selectedTabId,
    visitedTabs,
    serverError,
    refresh,
    scheduleRefresh,
    setConnected,
    tick,
    activeServerId,
  } = useMustr();

  useEffect(() => {
    void refresh();
    const unlistenEvent = listen("herdr-event", () => scheduleRefresh());
    const unlistenConn = listen<{ connected: boolean }>("herdr-conn", (e) =>
      setConnected(e.payload.connected),
    );
    const fallback = setInterval(refresh, 15000);
    const clock = setInterval(tick, 30000);
    // Clicking a macOS notification activates the app; route that activation
    // to the notified pane when it happens within half a minute.
    const onActivate = () => {
      if (lastNotified && Date.now() - lastNotified.at < 30_000) {
        useMustr.getState().selectPane(lastNotified.paneId);
      }
    };
    window.addEventListener("focus", onActivate);
    // App shortcuts — capture phase so focused terminals can't swallow
    // them; everything else flows through to the pane untouched.
    const onShortcut = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return;
      const st = useMustr.getState();
      const key = e.key.toLowerCase();
      const eat = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (!e.shiftKey && key === "k") {
        eat();
        setPaletteOpen((v) => !v);
        return;
      }
      if (!e.shiftKey && key === "t") {
        eat();
        void st.newTerminal();
        return;
      }
      if (!e.shiftKey && key === "f" && st.selectedPaneId) {
        eat();
        st.setFindOpen(true);
        return;
      }
      if (!e.shiftKey && (key === "=" || key === "+")) {
        eat();
        st.setTermFontSize(st.termFontSize + 1);
        return;
      }
      if (!e.shiftKey && key === "-") {
        eat();
        st.setTermFontSize(st.termFontSize - 1);
        return;
      }
      if (!e.shiftKey && key === "0") {
        eat();
        st.setTermFontSize(13);
        return;
      }
      if (!e.shiftKey && key === "d" && st.selectedPaneId) {
        eat();
        const paneId = st.selectedPaneId;
        void focusPane(paneId)
          .then(() => splitPane(paneId, "right"))
          .then(st.refresh);
        return;
      }
      if (e.shiftKey && key === "d" && st.selectedPaneId) {
        eat();
        const paneId = st.selectedPaneId;
        void focusPane(paneId)
          .then(() => splitPane(paneId, "down"))
          .then(st.refresh);
        return;
      }
      if (e.shiftKey && key === "z" && st.selectedPaneId) {
        eat();
        const paneId = st.selectedPaneId;
        void focusPane(paneId)
          .then(() => zoomPane(paneId))
          .then(st.refresh);
        return;
      }
      if (!e.shiftKey && key === "w" && st.selectedPaneId) {
        eat();
        setClosingPaneId(st.selectedPaneId);
        return;
      }
      // Tab navigation within the current workspace.
      const pane = st.panes.find((p) => p.pane_id === st.selectedPaneId);
      const workspaceTabs = st.tabs.filter((t) => t.workspace_id === pane?.workspace_id);
      if (!e.shiftKey && /^[1-9]$/.test(key) && workspaceTabs.length > 0) {
        const idx = Number(key) - 1;
        if (workspaceTabs[idx]) {
          eat();
          st.selectTab(workspaceTabs[idx].tab_id);
        }
        return;
      }
      if (e.shiftKey && (e.key === "}" || e.key === "{") && workspaceTabs.length > 1) {
        eat();
        const cur = workspaceTabs.findIndex((t) => t.tab_id === st.selectedTabId);
        const next =
          e.key === "}"
            ? (cur + 1) % workspaceTabs.length
            : (cur - 1 + workspaceTabs.length) % workspaceTabs.length;
        st.selectTab(workspaceTabs[next].tab_id);
      }
    };
    window.addEventListener("keydown", onShortcut, true);
    return () => {
      clearInterval(fallback);
      clearInterval(clock);
      window.removeEventListener("focus", onActivate);
      window.removeEventListener("keydown", onShortcut, true);
      unlistenEvent.then((fn) => fn());
      unlistenConn.then((fn) => fn());
    };
  }, [refresh, scheduleRefresh, setConnected, tick]);

  return (
    <TipProvider>
    <div className="flex h-full">
      <aside className="w-[256px] shrink-0 border-r border-border-subtle bg-sidebar">
        <Sidebar />
      </aside>

      <div key={activeServerId} className="flex min-w-0 flex-1 flex-col bg-content">
        <Toolbar />
        <TabStrip />
        <main className="relative min-h-0 flex-1">
          {/* Recently visited tabs stay mounted (hidden) so their pane
              connections and buffers are warm — switching is instant even
              over an SSH tunnel. */}
          {selectedPaneId ? (
            visitedTabs.map((tid) => (
              <div key={tid} className={tid === selectedTabId ? "h-full" : "hidden"}>
                <PaneGrid tabId={tid} />
              </div>
            ))
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-sm text-center">
                {serverError?.includes("herdr-not-installed") ? (
                  <>
                    <p className="text-[13px] font-semibold text-text-primary">
                      Herdr isn't installed
                    </p>
                    <p className="mt-1 text-[13px] leading-snug text-text-secondary">
                      Mustr drives the herdr runtime. Install it, then Mustr connects
                      on its own.
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openUrl("https://herdr.dev")}
                        className="rounded-lg bg-selection px-3 py-1.5 text-[13px] font-medium text-text-primary transition-colors duration-100 hover:bg-active active:scale-[0.97]"
                      >
                        Get herdr
                      </button>
                      <button
                        type="button"
                        onClick={() => void connectServer("local").then(refresh)}
                        className="rounded-lg px-3 py-1.5 text-[13px] text-text-primary transition-colors duration-100 hover:bg-hover active:scale-[0.97]"
                      >
                        Check again
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-semibold text-text-primary">
                      {serverError ? "Can't reach the herdr server" : "No pane selected"}
                    </p>
                    <p className="mt-1 text-[13px] leading-snug text-text-secondary">
                      {serverError
                        ? "Start it by running herdr in a terminal. Mustr reconnects automatically."
                        : "Choose an agent or terminal in the sidebar."}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
    <Navigator open={paletteOpen} onOpenChange={setPaletteOpen} />
    <Toasts />
    <ClosePaneDialog paneId={closingPaneId} onOpenChange={(o) => !o && setClosingPaneId(null)} />
    </TipProvider>
  );
}
