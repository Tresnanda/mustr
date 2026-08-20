// Right-click actions for a pane — mouse-first, like herdr itself.
// Splitting targets the clicked pane (focused first, since the server splits
// the focused pane); closing always confirms with the consequence stated.

import { useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { Columns, Rows, X } from "@phosphor-icons/react";
import { closePane, focusPane, splitPane } from "../../bridge/herdr";
import { useMustr } from "../../state/store";
import { paneDisplayName } from "../../lib/names";

const ITEM =
  "flex w-full cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-hover";

export function PaneMenu({ paneId, children }: { paneId: string; children: React.ReactNode }) {
  const { refresh, selectPane, panes } = useMustr();
  const [confirmClose, setConfirmClose] = useState(false);
  const pane = panes.find((p) => p.pane_id === paneId);

  const split = async (direction: "right" | "down") => {
    await focusPane(paneId).catch(() => {});
    selectPane(paneId);
    await splitPane(paneId, direction).catch(() => {});
    await refresh();
  };

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="z-30 w-52 rounded-xl bg-sidebar p-1.5 duration-150 ease-out data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95"
            style={{ boxShadow: "var(--shadow-popover)" }}
          >
            <ContextMenu.Item className={`${ITEM} text-text-primary`} onSelect={() => void split("right")}>
              <Columns size={15} className="text-text-secondary" aria-hidden />
              Split right
            </ContextMenu.Item>
            <ContextMenu.Item className={`${ITEM} text-text-primary`} onSelect={() => void split("down")}>
              <Rows size={15} className="text-text-secondary" aria-hidden />
              Split down
            </ContextMenu.Item>
            <ContextMenu.Separator className="mx-2 my-1 h-px bg-border-subtle" />
            <ContextMenu.Item
              className={`${ITEM} text-status-blocked`}
              onSelect={() => setConfirmClose(true)}
            >
              <X size={15} aria-hidden />
              Close terminal
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Dialog.Root open={confirmClose} onOpenChange={setConfirmClose}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-sidebar p-5"
            style={{ boxShadow: "var(--shadow-popover)" }}
          >
            <Dialog.Title className="text-[13px] font-semibold text-text-primary">
              Close {pane ? paneDisplayName(pane) : "this terminal"}?
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-[13px] leading-snug text-text-secondary">
              Anything running in it will end.
            </Dialog.Description>
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
                onClick={() => {
                  void closePane(paneId)
                    .then(refresh)
                    .finally(() => setConfirmClose(false));
                }}
                className="rounded-lg bg-status-blocked-soft px-3 py-1.5 text-[13px] font-medium text-status-blocked transition-colors duration-100 active:scale-[0.97]"
              >
                Close terminal
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
