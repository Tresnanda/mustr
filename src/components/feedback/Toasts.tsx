// Quiet connection toasts, bottom-right. One per server (replaced in
// place), auto-dismissed unless it's an ongoing "reconnecting" state.
// Enter/exit follow the doctrine: small rise + fade in, faster fade out.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { listen } from "@tauri-apps/api/event";
import { CircleNotch } from "@phosphor-icons/react";
import { useMustr } from "../../state/store";

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
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [servers.length]);

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="flex items-center gap-2 rounded-lg bg-[rgb(44_44_44/0.95)] px-3 py-2 backdrop-blur-xl"
            style={{
              boxShadow: "0 0 0 0.5px rgb(255 255 255 / 0.1), 0 6px 20px rgb(0 0 0 / 0.35)",
            }}
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
