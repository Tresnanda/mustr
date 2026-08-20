// Agent-status grammar, ink edition. Shape + label carry the state; the only
// color is blocked's amber. Toolbar status is plain text, not a chip.

import { CheckCircle, Circle, WarningCircle } from "@phosphor-icons/react";
import { ThinkingOrb } from "thinking-orbs";
import type { AgentStatus } from "../bridge/herdr";

const reducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: "Working",
  blocked: "Needs input",
  done: "Done",
  idle: "Idle",
  unknown: "Shell",
};

export function StatusIcon({ status, size = 14 }: { status: AgentStatus; size?: number }) {
  switch (status) {
    case "done":
      return <CheckCircle size={size} weight="fill" color="var(--status-done)" aria-hidden />;
    case "blocked":
      return <WarningCircle size={size} weight="fill" color="var(--status-blocked)" aria-hidden />;
    case "working":
      if (reducedMotion) {
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
          <ThinkingOrb state="working" size={20} theme="dark" />
        </span>
      );
    case "idle":
      return <Circle size={size} weight="bold" color="var(--status-idle)" aria-hidden />;
    default:
      return <Circle size={size} weight="regular" color="var(--status-unknown)" aria-hidden />;
  }
}
