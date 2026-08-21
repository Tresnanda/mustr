import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { motion, useReducedMotion } from "motion/react";
import { Folder } from "@phosphor-icons/react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { StatusAnnouncer } from "./components/status";
import { PaneGrid } from "./components/panes/PaneGrid";
import { TabStrip } from "./components/tabs/TabStrip";
import { dragHandlers } from "./components/DragRegion";
import { TipProvider } from "./components/ui/Tip";
import { Navigator } from "./components/command/Navigator";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { Toasts } from "./components/feedback/Toasts";
import { ClosePaneDialog } from "./components/panes/ClosePaneDialog";
import { BTN, BTN_PRIMARY } from "./components/ui/menu";
import { MustrMark } from "./components/ui/MustrMark";
import { useMustr } from "./state/store";
import { lastNotified } from "./bridge/notify";
import { connectServer } from "./bridge/servers";
import { splitPane, zoomPane, focusPane } from "./bridge/herdr";
import { openUrl } from "@tauri-apps/plugin-opener";
import { tweenFast } from "./design/motion";

/** Toolbar: tabs anchored leading, workspace name + shortcuts anchored
    trailing — everything centered on one axis, macOS toolbar grammar.
    The stretch between them is the window drag surface; the pane's own
    status lives in the sidebar row, not up here. */
function Toolbar() {
  const { panes, workspaces, selectedPaneId } = useMustr();
  const pane = panes.find((p) => p.pane_id === selectedPaneId) ?? null;
  const space = pane && workspaces.find((w) => w.workspace_id === pane.workspace_id)?.label;

  return (
    <header
      {...dragHandlers()}
      className="flex h-10 shrink-0 items-center gap-2.5 bg-[rgb(0_0_0/0.18)] pl-3 pr-5 shadow-[inset_0_-1px_0_rgb(255_255_255/0.05)]"
    >
      <TabStrip />
      <div className="min-w-0 flex-1 self-stretch" />
      {space && (
        <span className="flex min-w-0 shrink items-center gap-1.5 text-text-secondary">
          <Folder size={13} weight="light" className="shrink-0 text-text-muted" aria-hidden />
          <span className="min-w-0 truncate text-[12.5px] font-medium tracking-[-0.01em]">
            {space}
          </span>
        </span>
      )}
      <ShortcutsHelp />
    </header>
  );
}

function EmptyState({
  serverError,
  onInstall,
  onRetry,
}: {
  serverError: string | null;
  onInstall: () => void;
  onRetry: () => void;
}) {
  const reduce = useReducedMotion();
  const missing = serverError?.includes("herdr-not-installed");

  return (
    <motion.div
      className="max-w-[20rem] px-6 text-center"
      initial={reduce || !missing ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce || !missing ? { duration: 0 } : tweenFast}
    >
      <MustrMark width={44} className="mx-auto mb-4 text-text-muted opacity-60" aria-hidden />
      {missing ? (
        <>
          <p className="text-[14px] font-semibold tracking-[-0.015em] text-balance text-text-primary">
            Herdr isn't installed
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-pretty text-text-secondary">
            Mustr drives the herdr runtime. Install it, then Mustr connects on its own.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" onClick={onInstall} className={BTN_PRIMARY}>
              Get herdr
            </button>
            <button type="button" onClick={onRetry} className={BTN}>
              Check again
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[14px] font-semibold tracking-[-0.015em] text-balance text-text-primary">
            {serverError ? "Unable to reach the herdr server" : "No pane selected"}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-pretty text-text-secondary">
            {serverError
              ? "Start herdr in a terminal. Mustr reconnects automatically."
              : "Choose an agent or terminal in the sidebar."}
          </p>
        </>
      )}
    </motion.div>
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
    // Events are tagged with the server they came from; this window only
    // mirrors its own. Any conn change refreshes the registry so the
    // session switcher stays honest across windows.
    const unlistenEvent = listen<{ server: string }>("herdr-event", (e) => {
      if (e.payload.server === useMustr.getState().activeServerId) scheduleRefresh();
    });
    const unlistenConn = listen<{ server: string; connected: boolean }>("herdr-conn", (e) => {
      const st = useMustr.getState();
      if (e.payload.server === st.activeServerId) {
        setConnected(e.payload.connected);
        // Re-seed right away on restore — tab trees and snapshots may
        // have failed while the server was unreachable.
        if (e.payload.connected) void st.refresh();
      }
      void st.loadServers();
    });
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
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[var(--z-tooltip)] focus:rounded-md focus:bg-opaque focus:px-3 focus:py-1.5 focus:text-[13px] focus:text-text-primary"
      >
        Skip to terminals
      </a>
      <aside className="w-[272px] shrink-0 bg-sidebar">
        <Sidebar />
      </aside>

      <div key={activeServerId} className="flex min-w-0 flex-1 flex-col bg-content shadow-[inset_1px_0_0_rgb(255_255_255/0.05)]">
        <Toolbar />
        <main id="main" className="relative min-h-0 flex-1">
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
              <EmptyState
                serverError={serverError}
                onInstall={() => void openUrl("https://herdr.dev")}
                onRetry={() => void connectServer(activeServerId).then(refresh)}
              />
            </div>
          )}
        </main>
      </div>
    </div>
    <Navigator open={paletteOpen} onOpenChange={setPaletteOpen} />
    <Toasts />
    <StatusAnnouncer />
    <ClosePaneDialog paneId={closingPaneId} onOpenChange={(o) => !o && setClosingPaneId(null)} />
    </TipProvider>
  );
}
