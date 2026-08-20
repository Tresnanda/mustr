// BSP pane grid: recursive render of herdr's layout tree. Split handles track
// the pointer 1:1 with pointer capture (Apple fluid-interface rule: feedback
// is continuous during the drag), preview locally, and commit the ratio to
// the server on release. Ratios clamp softly at 15% per side.

import { useCallback, useRef, useState } from "react";
import { setSplitRatio, type LayoutNode } from "../../bridge/herdr";
import { useMustr } from "../../state/store";
import { TerminalView } from "../terminal/TerminalView";
import { PaneMenu } from "./PaneMenu";

const MIN_RATIO = 0.15;
const HANDLE_PX = 7;

function SplitHandle({
  direction,
  onDrag,
  onCommit,
}: {
  direction: "right" | "down";
  onDrag: (delta: number, span: number) => void;
  onCommit: () => void;
}) {
  const vertical = direction === "right"; // splits left|right → vertical bar
  const start = useRef<{ pos: number; span: number } | null>(null);

  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const parent = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        start.current = {
          pos: vertical ? e.clientX : e.clientY,
          span: vertical ? parent.width : parent.height,
        };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const pos = vertical ? e.clientX : e.clientY;
        onDrag(pos - start.current.pos, start.current.span);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        start.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        onCommit();
      }}
      className={`group relative z-10 shrink-0 ${
        vertical ? "w-[7px] cursor-col-resize" : "h-[7px] cursor-row-resize"
      }`}
      style={{ margin: vertical ? "0 -3px" : "-3px 0" }}
    >
      {/* hairline that brightens on hover/drag */}
      <span
        className={`absolute bg-border-subtle transition-colors duration-100 group-hover:bg-border-strong group-active:bg-text-muted ${
          vertical ? "inset-y-0 left-1/2 w-px -translate-x-1/2" : "inset-x-0 top-1/2 h-px -translate-y-1/2"
        }`}
        aria-hidden
      />
    </div>
  );
}

function Node({
  node,
  path,
  tabId,
  focusedPaneId,
  overrides,
  setOverride,
}: {
  node: LayoutNode;
  path: string[];
  tabId: string;
  focusedPaneId: string | null;
  overrides: Map<string, number>;
  setOverride: (key: string, ratio: number | null) => void;
}) {
  const selectPane = useMustr((s) => s.selectPane);

  if (node.type === "pane") {
    const focused = node.pane_id === focusedPaneId;
    return (
      <PaneMenu paneId={node.pane_id}>
        <div
          className={`relative min-h-0 min-w-0 flex-1 overflow-hidden ${
            focused ? "shadow-[inset_0_0_0_1px_var(--border-strong)]" : ""
          }`}
          onMouseDownCapture={() => {
            if (!focused) selectPane(node.pane_id);
          }}
        >
          <TerminalView paneId={node.pane_id} />
        </div>
      </PaneMenu>
    );
  }

  const key = path.join("/") || "root";
  const ratio = overrides.get(key) ?? node.ratio;
  const vertical = node.direction === "right";

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${vertical ? "flex-row" : "flex-col"}`}>
      <div style={{ flexBasis: `${ratio * 100}%` }} className="flex min-h-0 min-w-0">
        <Node
          node={node.first}
          path={[...path, "first"]}
          tabId={tabId}
          focusedPaneId={focusedPaneId}
          overrides={overrides}
          setOverride={setOverride}
        />
      </div>
      <SplitHandle
        direction={node.direction}
        onDrag={(delta, span) => {
          const next = Math.min(
            1 - MIN_RATIO,
            Math.max(MIN_RATIO, node.ratio + delta / Math.max(1, span - HANDLE_PX)),
          );
          setOverride(key, next);
        }}
        onCommit={() => {
          const committed = overrides.get(key);
          if (committed !== undefined && Math.abs(committed - node.ratio) > 0.001) {
            void setSplitRatio(tabId, path, committed).catch(() => setOverride(key, null));
          }
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <Node
          node={node.second}
          path={[...path, "second"]}
          tabId={tabId}
          focusedPaneId={focusedPaneId}
          overrides={overrides}
          setOverride={setOverride}
        />
      </div>
    </div>
  );
}

export function PaneGrid({ tabId }: { tabId: string }) {
  const { trees, selectedPaneId, selectedTabId, layouts } = useMustr();
  const tree = trees[tabId] ?? null;
  const active = tabId === selectedTabId;
  const zoomed = layouts.find((l) => l.tab_id === tabId)?.zoomed ?? false;
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());

  const setOverride = useCallback((key: string, ratio: number | null) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      if (ratio === null) next.delete(key);
      else next.set(key, ratio);
      return next;
    });
  }, []);

  if (!tree) return null;
  const focusedPaneId = active ? selectedPaneId : null;
  if (zoomed && active && selectedPaneId) {
    return (
      <div className="flex h-full min-h-0">
        <PaneMenu paneId={selectedPaneId}>
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            <TerminalView paneId={selectedPaneId} />
          </div>
        </PaneMenu>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0">
      <Node
        node={tree}
        path={[]}
        tabId={tabId}
        focusedPaneId={focusedPaneId}
        overrides={overrides}
        setOverride={setOverride}
      />
    </div>
  );
}
