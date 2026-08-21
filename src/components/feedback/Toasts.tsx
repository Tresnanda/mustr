// Quiet connection toasts, bottom-right. One per server (replaced in
// place), auto-dismissed unless it's an ongoing "reconnecting" state.
// Enter/exit follow the doctrine: small rise + fade in, faster fade out.

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { listen } from "@tauri-apps/api/event";
import { CircleNotch } from "@phosphor-icons/react";
import { useMustr } from "../../state/store";
import { MATERIAL_PANEL, MENU_SHADOW } from "../ui/menu";
import { easeOut, tweenBase, tweenExit } from "../../design/motion";

interface Toast {
  key: string;
  text: string;
  spinning: boolean;
  /** Sticky toasts stay until replaced (e.g. while reconnecting). */
  sticky: boolean;
}

export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const servers = useMustr((s) => s.servers);
  const reduce = useReducedMotion();

  useEffect(() => {
    const nameOf = (id: string) =>
      useMustr.getState().servers.find((s) => s.id === id)?.name ?? id;

    const put = (toast: Toast, ttl?: number) => {
      setToasts((prev) => [...prev.filter((t) => t.key !== toast.key), toast]);
      if (ttl) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t !== toast));
        }, ttl);
      }
    };

    const unlisten = listen<{ status: string; id: string; error?: string }>(
      "herdr-tunnel",
      (e) => {
        const name = nameOf(e.payload.id);
        const key = `tunnel:${e.payload.id}`;
        if (e.payload.status === "reconnecting") {
          put({ key, text: `Reconnecting to ${name}…`, spinning: true, sticky: true });
        } else if (e.payload.status === "restored") {
          put({ key, text: `Connection to ${name} restored`, spinning: false, sticky: false }, 4000);
        } else if (e.payload.status === "down") {
          put(
            { key, text: `${name} is unreachable — retrying`, spinning: true, sticky: true },
          );
        }
      },
    );
    // A found update gets one quiet mention; Settings carries the action.
    const onUpdate = (e: Event) => {
      const version = (e as CustomEvent<{ version: string }>).detail.version;
      put(
        {
          key: "app-update",
          text: `Mustr ${version} is available — update from Settings`,
          spinning: false,
          sticky: false,
        },
        8000,
      );
    };
    window.addEventListener("mustr:update-available", onUpdate);

    return () => {
      unlisten.then((fn) => fn());
      window.removeEventListener("mustr:update-available", onUpdate);
    };
  }, [servers.length]);

  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-[var(--z-toast)] flex flex-col items-end gap-2"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.key}
            layout
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, transition: tweenExit }}
            transition={reduce ? { duration: 0 } : { ...tweenBase, ease: easeOut }}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 ${MATERIAL_PANEL}`}
            style={MENU_SHADOW}
          >
            {toast.spinning && (
              <CircleNotch size={13} className="animate-spin text-text-secondary" aria-hidden />
            )}
            <span className="text-[12.5px] text-text-primary">{toast.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
