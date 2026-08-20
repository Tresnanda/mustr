// Footer device row (reference grammar: identity row pinned at the sidebar
// bottom). Click opens the Devices popover; SSH quickies land here in M2.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretUpDown, Check, Desktop, Plus } from "@phosphor-icons/react";
import { useMustr } from "../../state/store";

const POP_SPRING = { type: "spring", duration: 0.3, bounce: 0 } as const;

export function DevicePill() {
  const { server, connected } = useMustr();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0 px-3 pb-3 pt-1">
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Devices"
            initial={{ opacity: 0, scale: 0.95, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 3, transition: { duration: 0.12 } }}
            transition={POP_SPRING}
            style={{ transformOrigin: "bottom left", boxShadow: "var(--shadow-popover)" }}
            className="absolute bottom-full left-3 z-20 mb-2 w-64 rounded-xl bg-sidebar p-1.5"
          >
            <p className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              Devices
            </p>
            <button
              type="button"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-lg bg-selection px-2.5 py-2 text-left"
            >
              <Desktop size={16} className="shrink-0 text-text-secondary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary">
                  Local
                  <span
                    className={`size-[5px] rounded-full ${connected ? "bg-alive" : "bg-status-blocked"}`}
                    aria-label={connected ? "connected" : "offline"}
                  />
                </span>
                <span className="block truncate text-[11.5px] text-text-secondary">
                  This Mac · herdr.sock
                </span>
              </span>
              <Check size={14} weight="bold" className="shrink-0 text-text-primary" aria-label="selected" />
            </button>
            <button
              type="button"
              role="menuitem"
              aria-disabled="true"
              onClick={(e) => e.preventDefault()}
              className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-text-secondary"
              title="SSH remotes arrive in the next milestone"
            >
              <Plus size={16} className="shrink-0" aria-hidden />
              <span className="text-[13px]">Add Device…</span>
              <span className="ml-auto rounded-full bg-hover px-1.5 py-px text-[10px] font-medium text-text-muted">
                Soon
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-100 hover:bg-hover"
      >
        <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-hover">
          <Desktop size={13} className="text-text-secondary" aria-hidden />
          <span
            className={`absolute -bottom-px -right-px size-[7px] rounded-full border-2 border-sidebar ${
              connected ? "bg-alive" : "bg-status-blocked"
            }`}
            aria-label={connected ? "connected" : "offline"}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-text-primary">Local</span>
          <span className="block truncate text-[11.5px] text-text-secondary">
            {server ? `This Mac · herdr ${server.version}` : "This Mac"}
          </span>
        </span>
        <CaretUpDown size={12} className="shrink-0 text-text-muted" aria-hidden />
      </button>
    </div>
  );
}
