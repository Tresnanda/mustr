// Shared rename dialog: focused input, Enter commits, Esc cancels.

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BTN, BTN_PRIMARY, DIALOG_CONTENT, DIALOG_OVERLAY, FIELD, DIALOG_SHADOW } from "./menu";

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
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content className={DIALOG_CONTENT} style={DIALOG_SHADOW}>
          <Dialog.Title className="text-[13px] font-semibold text-balance text-text-primary">
            {title}
          </Dialog.Title>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
            aria-label={title}
            style={{ outline: "none" }}
            className={`${FIELD} mt-3`}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className={BTN}>
                Cancel
              </button>
            </Dialog.Close>
            <button type="button" onClick={commit} className={BTN_PRIMARY}>
              Rename
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
