import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/sidebar/Sidebar";
import { STATUS_LABEL } from "./components/status";
import { PaneGrid } from "./components/panes/PaneGrid";
import { TabStrip } from "./components/tabs/TabStrip";
import { dragHandlers } from "./components/DragRegion";
import { TipProvider } from "./components/ui/Tip";
import { statusSince, useMustr } from "./state/store";
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
  const { selectedPaneId, serverError, refresh, scheduleRefresh, setConnected, tick } = useMustr();

  useEffect(() => {
    void refresh();
    const unlistenEvent = listen("herdr-event", () => scheduleRefresh());
    const unlistenConn = listen<{ connected: boolean }>("herdr-conn", (e) =>
      setConnected(e.payload.connected),
    );
    const fallback = setInterval(refresh, 15000);
    const clock = setInterval(tick, 30000);
    return () => {
      clearInterval(fallback);
      clearInterval(clock);
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

      <div className="flex min-w-0 flex-1 flex-col bg-content">
        <Toolbar />
        <TabStrip />
        <main className="min-h-0 flex-1">
          {/* Pane/tab switching is high-frequency: instant, no transition. */}
          {selectedPaneId ? (
            <PaneGrid />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-sm text-center">
                <p className="text-[13px] font-semibold text-text-primary">
                  {serverError ? "Can't reach the herdr server" : "No pane selected"}
                </p>
                <p className="mt-1 text-[13px] leading-snug text-text-secondary">
                  {serverError
                    ? "Start it by running herdr in a terminal. Mustr reconnects automatically."
                    : "Choose an agent or terminal in the sidebar."}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
    </TipProvider>
  );
}
