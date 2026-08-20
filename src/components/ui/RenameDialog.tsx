// Shared rename dialog: focused input, Enter commits, Esc cancels.

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MENU_SHADOW } from "./menu";

export function RenameDialog({
  open,
  title,
  initial,
  onRename,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  initial: string;
  onRename: (label: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [value, setValue] = useState(initial);

  const commit = () => {
    const label = value.trim();
    if (label && label !== initial) onRename(label);
    onOpenChange(false);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(initial);
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-sidebar p-5"
          style={MENU_SHADOW}
        >
          <Dialog.Title className="text-[13px] font-semibold text-text-primary">{title}</Dialog.Title>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
            aria-label={title}
            style={{ outline: "none" }}
            className="mt-3 h-8 w-full rounded-lg border border-border-subtle bg-inset px-2.5 text-[13px] text-text-primary transition-colors duration-100 focus:border-border-strong"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-[13px] text-text-primary transition-colors duration-100 hover:bg-hover active:scale-[0.97]"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={commit}
              className="rounded-lg bg-selection px-3 py-1.5 text-[13px] font-medium text-text-primary transition-colors duration-100 hover:bg-active active:scale-[0.97]"
            >
              Rename
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
