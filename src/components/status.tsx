// Agent-status grammar, ink edition. Shape + label carry the state; the only
// color is blocked's amber. Toolbar status is plain text, not a chip.
// State swaps use the transitions.dev icon swap: the outgoing glyph blurs
// and shrinks away while the incoming one resolves in (see .t-icon-swap).

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { CheckCircle, Circle, WarningCircle } from "@phosphor-icons/react";
import type { AgentStatus } from "../bridge/herdr";
import { paneDisplayName } from "../lib/names";
import { useMustr } from "../state/store";

// Working indicator: three ink dots orbiting a common centre. Replaces the
// thinking-orbs "breathing" orb, whose animated SVG blur filter forced the
// backdrop-filter glass beneath it to re-rasterize every frame (~14 GPU-points
// per orb, measured). This is transform-only — the compositor just re-rotates
// one already-rasterized layer, no repaint, no filter — so it costs a fraction
// while keeping live feedback. Monochrome by design: colour is reserved for
// blocked (amber). Reduced-motion callers get the static dot instead (below).
function TripleDotSpinner({ size }: { size: number }) {
  const dot = Math.max(2, Math.round(size * 0.22));
  return (
    <div
      className="triple-dot-spin relative text-text-secondary"
      style={{ width: size, height: size }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute left-1/2 top-0 rounded-full bg-current"
          style={{
            width: dot,
            height: dot,
            marginLeft: -dot / 2,
            transformOrigin: `${dot / 2}px ${size / 2}px`,
            transform: `rotate(${i * 120}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: "Working",
  blocked: "Needs input",
  done: "Done",
  idle: "Idle",
  unknown: "Shell",
};

function Glyph({ status, size, reduce }: { status: AgentStatus; size: number; reduce: boolean }) {
  switch (status) {
    case "done":
      return <CheckCircle size={size} weight="fill" color="var(--status-done)" aria-hidden />;
    case "blocked":
      return <WarningCircle size={size} weight="fill" color="var(--status-blocked)" aria-hidden />;
    case "working":
      if (reduce) {
        return (
          <span
            className="inline-block shrink-0 rounded-full bg-status-working"
            style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }}
            aria-hidden
          />
        );
      }
      return (
        <span className="inline-flex shrink-0" aria-hidden>
          <TripleDotSpinner size={size + 4} />
        </span>
      );
    case "idle":
      return <Circle size={size} weight="bold" color="var(--status-idle)" aria-hidden />;
    default:
      return <Circle size={size} weight="regular" color="var(--status-unknown)" aria-hidden />;
  }
}

/** How long .t-icon-swap takes (--icon-swap-dur) plus a little slack. */
const SWAP_SETTLE_MS = 300;

export function StatusIcon({ status, size = 14 }: { status: AgentStatus; size?: number }) {
  const reduce = useReducedMotion();
  // Double buffer for the CSS icon swap: the new status lands in the
  // hidden slot, then data-state flips so CSS runs the cross-blur.
  const [slots, setSlots] = useState<{ a: AgentStatus; b: AgentStatus; active: "a" | "b" }>({
    a: status,
    b: status,
    active: "a",
  });
  if (slots[slots.active] !== status) {
    setSlots(
      slots.active === "a"
        ? { a: slots.a, b: status, active: "b" }
        : { a: status, b: slots.b, active: "a" },
    );
  }
  // Once the swap settles, retire the hidden slot to the active status so
  // an invisible orb doesn't keep animating behind the dot.
  useEffect(() => {
    const hidden = slots.active === "a" ? "b" : "a";
    if (slots[hidden] === slots[slots.active]) return;
    const t = setTimeout(
      () =>
        setSlots((s) =>
          s.active === "a" ? { ...s, b: s.a } : { ...s, a: s.b },
        ),
      SWAP_SETTLE_MS,
    );
    return () => clearTimeout(t);
  }, [slots]);

  return (
    <span className="t-icon-swap size-5 shrink-0" data-state={slots.active}>
      <span className="t-icon inline-flex items-center justify-center" data-icon="a">
        <Glyph status={slots.a} size={size} reduce={Boolean(reduce)} />
      </span>
      <span className="t-icon inline-flex items-center justify-center" data-icon="b">
        <Glyph status={slots.b} size={size} reduce={Boolean(reduce)} />
      </span>
    </span>
  );
}

/** Polite live region: announces selected-pane status changes, never the ticking age. */
export function StatusAnnouncer() {
  const { panes, selectedPaneId } = useMustr();
  const pane = panes.find((p) => p.pane_id === selectedPaneId) ?? null;
  const prev = useRef<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!pane) return;
    const key = `${pane.pane_id}:${pane.agent_status}`;
    if (prev.current && prev.current !== key) {
      setMessage(`${paneDisplayName(pane)}, ${STATUS_LABEL[pane.agent_status]}`);
    }
    prev.current = key;
  }, [pane]);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
