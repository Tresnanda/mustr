// Settings — essentials only, labels describe the ON state, everything
// applies immediately (no Save button to babysit).

import * as Dialog from "@radix-ui/react-dialog";
import { Minus, Plus } from "@phosphor-icons/react";
import { useMustr } from "../../state/store";
import { DIALOG_CONTENT, DIALOG_OVERLAY, MENU_SHADOW } from "../ui/menu";

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
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left transition-colors duration-100 hover:bg-hover"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-text-primary">{label}</span>
        {detail && <span className="block text-[11.5px] text-text-secondary">{detail}</span>}
      </span>
      <span
        aria-hidden
        className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-150 ${
          on ? "bg-alive" : "bg-[rgb(255_255_255/0.14)]"
        }`}
      >
        <span
          className={`absolute top-[2px] size-[14px] rounded-full bg-white transition-transform duration-150 ${
            on ? "translate-x-[16px]" : "translate-x-[2px]"
          }`}
          style={{ transitionTimingFunction: "var(--ease-out)" }}
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
        <Dialog.Content className={`${DIALOG_CONTENT} w-[360px]`} style={MENU_SHADOW}>
          <Dialog.Title className="text-[13px] font-semibold text-text-primary">
            Settings
          </Dialog.Title>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            Terminal
          </p>
          <div className="mt-1.5 flex items-center justify-between rounded-lg px-1 py-1.5">
            <span className="text-[13px] text-text-primary">Text size</span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Smaller text"
                onClick={() => setTermFontSize(termFontSize - 1)}
                className="flex size-6 items-center justify-center rounded-md bg-[rgb(255_255_255/0.07)] text-text-secondary transition-colors duration-100 hover:text-text-primary active:scale-[0.94]"
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
                className="flex size-6 items-center justify-center rounded-md bg-[rgb(255_255_255/0.07)] text-text-secondary transition-colors duration-100 hover:text-text-primary active:scale-[0.94]"
              >
                <Plus size={12} aria-hidden />
              </button>
            </span>
          </div>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
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

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
