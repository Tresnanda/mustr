// Settings — essentials only, labels describe the ON state, everything
// applies immediately (no Save button to babysit).

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import * as Dialog from "@radix-ui/react-dialog";
import { Minus, Plus } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { listPlugins } from "../../bridge/herdr";
import { useMustr } from "../../state/store";
import { DIALOG_CONTENT, DIALOG_OVERLAY, DIALOG_SHADOW } from "../ui/menu";
import { MustrMark } from "../ui/MustrMark";
import { springSettle } from "../../design/motion";

function ToggleRow({
  label,
  detail,
  on,
  onChange,
}: {
  label: string;
  detail?: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left transition-[background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-text-primary">{label}</span>
        {detail && <span className="block text-[11.5px] text-text-secondary">{detail}</span>}
      </span>
      <span
        aria-hidden
        className={`relative h-[18px] w-8 shrink-0 rounded-full transition-[background-color] duration-[var(--dur-base)] ease-[var(--ease-out)] ${
          on ? "bg-alive" : "bg-[rgb(255_255_255/0.14)]"
        }`}
      >
        <motion.span
          className="absolute top-[2px] left-0 size-[14px] rounded-full bg-white"
          initial={false}
          animate={{ x: on ? 16 : 2 }}
          transition={reduce ? { duration: 0 } : springSettle}
        />
      </span>
    </button>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [plugins, setPlugins] = useState<{ id?: string; name?: string; enabled?: boolean }[]>([]);
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (open) void listPlugins().then((r) => setPlugins(r.plugins ?? [])).catch(() => setPlugins([]));
  }, [open]);
  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);

  const {
    termFontSize,
    setTermFontSize,
    notifyBlocked,
    notifyDone,
    setNotifyPref,
    appearance,
    setAppearance,
  } = useMustr();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content className={`${DIALOG_CONTENT} w-[360px]`} style={DIALOG_SHADOW}>
          <Dialog.Title className="text-[13px] font-semibold text-balance text-text-primary">
            Settings
          </Dialog.Title>

          <p className="mt-4 text-[11px] font-semibold tracking-[0.02em] text-text-muted uppercase">
            Terminal
          </p>
          <div className="mt-1.5 flex items-center justify-between rounded-lg px-1 py-1.5">
            <span className="text-[13px] text-text-primary">Text size</span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Smaller text"
                onClick={() => setTermFontSize(termFontSize - 1)}
                className="flex size-7 items-center justify-center rounded-md bg-[rgb(255_255_255/0.07)] text-text-secondary transition-[color,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-text-primary active:scale-[0.97]"
              >
                <Minus size={12} aria-hidden />
              </button>
              <span className="w-9 text-center text-[12.5px] tabular-nums text-text-primary">
                {termFontSize}px
              </span>
              <button
                type="button"
                aria-label="Larger text"
                onClick={() => setTermFontSize(termFontSize + 1)}
                className="flex size-7 items-center justify-center rounded-md bg-[rgb(255_255_255/0.07)] text-text-secondary transition-[color,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-text-primary active:scale-[0.97]"
              >
                <Plus size={12} aria-hidden />
              </button>
            </span>
          </div>

          <p className="mt-4 text-[11px] font-semibold tracking-[0.02em] text-text-muted uppercase">
            Notifications
          </p>
          <div className="mt-1.5">
            <ToggleRow
              label="Notify when an agent needs input"
              on={notifyBlocked}
              onChange={(on) => setNotifyPref("blocked", on)}
            />
            <ToggleRow
              label="Notify when an agent finishes"
              on={notifyDone}
              onChange={(on) => setNotifyPref("done", on)}
            />
          </div>

          <p className="mt-4 text-[11px] font-semibold tracking-[0.02em] text-text-muted uppercase">
            Appearance
          </p>
          <div className="mt-1.5">
            <ToggleRow
              label="Glass window"
              detail="Frost the wallpaper through the chrome"
              on={appearance === "glass"}
              onChange={(on) => setAppearance(on ? "glass" : "solid")}
            />
          </div>

          <p className="mt-4 text-[11px] font-semibold tracking-[0.02em] text-text-muted uppercase">
            Herdr plugins
          </p>
          <div className="mt-1.5">
            {plugins.length === 0 ? (
              <p className="px-1 text-[12.5px] leading-snug text-pretty text-text-secondary">
                No plugins on this server yet.
              </p>
            ) : (
              plugins.map((plugin, i) => (
                <div key={plugin.id ?? i} className="flex items-center gap-3 px-1 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                    {plugin.name ?? plugin.id}
                  </span>
                  <span className="text-[11.5px] text-text-muted">
                    {plugin.enabled === false ? "Disabled" : "Enabled"}
                  </span>
                </div>
              ))
            )}
            <button
              type="button"
              onClick={() => void openUrl("https://herdr.dev/plugins/")}
              className="mt-1 rounded-md px-1 text-[12.5px] text-text-secondary underline decoration-[rgb(255_255_255/0.2)] underline-offset-2 transition-[color] duration-[var(--dur-fast)] hover:text-text-primary"
            >
              Browse the plugin marketplace
            </button>
          </div>

          {/* Quiet about-footer: the herd mark carries the identity, the
              version reads as a caption. Grouped from the sections above
              with space, not a rule. */}
          <div className="mt-7 mb-1 flex flex-col items-center gap-1.5 text-text-muted">
            <MustrMark width={26} aria-hidden />
            <span className="text-[11px] tabular-nums">
              Mustr{version ? ` ${version}` : ""}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
