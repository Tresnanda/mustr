// BSP pane grid: recursive render of herdr's layout tree. Split handles track
// the pointer 1:1 with pointer capture (Apple fluid-interface rule: feedback
// is continuous during the drag), preview locally, rubber-band past the 15%
// min, and spring-settle to the clamped ratio on release.

import { useCallback, useEffect, useRef, useState } from "react";
import { animate } from "motion";
import { setSplitRatio, type LayoutNode } from "../../bridge/herdr";
import { useMustr } from "../../state/store";
import { TerminalView } from "../terminal/TerminalView";
import { PaneMenu } from "./PaneMenu";
import { springSettle } from "../../design/motion";

const MIN_RATIO = 0.15;
const HANDLE_PX = 7;

function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

function rubberbandRatio(raw: number, span: number) {
  const min = MIN_RATIO;
  const max = 1 - MIN_RATIO;
  if (raw >= min && raw <= max) return raw;
  if (raw < min) {
    const overshootPx = (min - raw) * span;
    return min - rubberband(overshootPx, span) / span;
  }
  const overshootPx = (raw - max) * span;
  return max + rubberband(overshootPx, span) / span;
}

function SplitHandle({
  direction,
  onDragStart,
  onDrag,
  onCommit,
}: {
  direction: "right" | "down";
  onDragStart: () => void;
  onDrag: (delta: number, span: number) => void;
  onCommit: (velocityPxPerSec: number, span: number) => void;
}) {
  const vertical = direction === "right"; // splits left|right → vertical bar
  const start = useRef<{ pos: number; span: number } | null>(null);
  const last = useRef({ t: 0, pos: 0, v: 0 });

  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const parent = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const pos = vertical ? e.clientX : e.clientY;
        const span = vertical ? parent.width : parent.height;
        start.current = { pos, span };
        last.current = { t: performance.now(), pos, v: 0 };
        onDragStart();
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const pos = vertical ? e.clientX : e.clientY;
        const now = performance.now();
        const dt = now - last.current.t;
        if (dt > 0) last.current.v = (pos - last.current.pos) / (dt / 1000);
        last.current = { t: now, pos, v: last.current.v };
        onDrag(pos - start.current.pos, start.current.span);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const span = start.current.span;
        const velocity = last.current.v;
        start.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        onCommit(velocity, span);
      }}
      className={`group relative z-10 shrink-0 ${
        vertical ? "w-[7px] cursor-col-resize" : "h-[7px] cursor-row-resize"
      }`}
      style={{ margin: vertical ? "0 -3px" : "-3px 0" }}
    >
      <span
        className={`absolute bg-border-subtle transition-[background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] group-hover:bg-border-strong group-active:bg-text-muted ${
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
  const dragStart = useRef(0);
  const animRef = useRef<ReturnType<typeof animate> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      animRef.current?.stop();
    };
  }, []);

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

  const commit = (clamped: number) => {
    if (Math.abs(clamped - node.ratio) > 0.001) {
      void setSplitRatio(tabId, path, clamped).catch(() => setOverride(key, null));
    } else {
      setOverride(key, null);
    }
  };

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
        onDragStart={() => {
          animRef.current?.stop();
          animRef.current = null;
          dragStart.current = overrides.get(key) ?? node.ratio;
        }}
        onDrag={(delta, span) => {
          const raw = dragStart.current + delta / Math.max(1, span - HANDLE_PX);
          setOverride(key, rubberbandRatio(raw, span));
        }}
        onCommit={(velocityPxPerSec, span) => {
          const current = overrides.get(key) ?? node.ratio;
          const clamped = Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, current));
          if (Math.abs(current - clamped) > 0.002) {
            const velocity = velocityPxPerSec / Math.max(1, span);
            animRef.current = animate(current, clamped, {
              ...springSettle,
              velocity,
              onUpdate: (v) => {
                if (mounted.current) setOverride(key, v);
              },
              onComplete: () => {
                animRef.current = null;
                if (mounted.current) commit(clamped);
              },
            });
          } else {
            commit(clamped);
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
