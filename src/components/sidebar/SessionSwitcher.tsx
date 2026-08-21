// Segmented control over the live herdr sessions. Hidden until a second
// host is connected, so single-host windows carry no extra chrome. The
// pool keeps every session warm, so a segment click retargets this window
// instantly; the raised thumb slides between segments (spring, no bounce,
// interruptible). Right-click a segment for window and disconnect actions.

import { useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useMustr } from "../../state/store";
import { disconnectServer, openHostWindow } from "../../bridge/servers";
import { MENU_CONTENT, MENU_ITEM, MENU_ITEM_DANGER, MENU_SHADOW } from "../ui/menu";
import { springSettle } from "../../design/motion";

export function SessionSwitcher() {
  const servers = useMustr((s) => s.servers);
  const activeServerId = useMustr((s) => s.activeServerId);
  const connectingId = useMustr((s) => s.connectingId);
  const switchServer = useMustr((s) => s.switchServer);
  const loadServers = useMustr((s) => s.loadServers);
  const reduce = useReducedMotion();
  const groupRef = useRef<HTMLDivElement>(null);

  const live = servers.filter((s) => s.connected);
  if (live.length < 2) return null;

  const select = (id: string, index: number) => {
    void switchServer(id);
    const radios = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios?.[index]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const current = Math.max(0, live.findIndex((s) => s.id === activeServerId));
    const next =
      e.key === "ArrowRight"
        ? (current + 1) % live.length
        : (current - 1 + live.length) % live.length;
    select(live[next].id, next);
  };

  return (
    <div className="px-3.5 pt-2">
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label="Connected sessions"
        onKeyDown={onKeyDown}
        className="flex gap-0.5 rounded-lg bg-hover p-0.5"
      >
        {live.map((s, i) => {
          const selected = s.id === activeServerId;
          const pending = connectingId === s.id;
          return (
            <ContextMenu.Root key={s.id}>
              <ContextMenu.Trigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(s.id, i)}
                  className={`relative h-6 min-w-0 flex-1 rounded-[6px] px-2 text-[11.5px] font-medium transition-[color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] ${
                    selected ? "text-text-primary" : "text-text-muted hover:text-text-secondary"
                  } ${pending ? "opacity-60" : ""}`}
                >
                  {selected && (
                    <motion.span
                      layoutId="session-thumb"
                      transition={reduce ? { duration: 0 } : springSettle}
                      className="absolute inset-0 rounded-[6px] bg-selection"
                      aria-hidden
                    />
                  )}
                  <span className="relative block truncate">{s.name}</span>
                </button>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className={MENU_CONTENT} style={MENU_SHADOW}>
                  <ContextMenu.Item
                    className={MENU_ITEM}
                    onSelect={() => void openHostWindow(s.id).then(loadServers)}
                  >
                    Open in new window
                  </ContextMenu.Item>
                  {s.kind === "ssh" && !selected && (
                    <ContextMenu.Item
                      className={MENU_ITEM_DANGER}
                      onSelect={() => void disconnectServer(s.id).then(loadServers)}
                    >
                      Disconnect
                    </ContextMenu.Item>
                  )}
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
    </div>
  );
}
