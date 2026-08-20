// Right-click actions for a pane — mouse-first, like herdr itself.
// Splitting targets the clicked pane (focused first, since the server splits
// the focused pane); closing always confirms with the consequence stated.

import { useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { closePane, focusPane, splitPane } from "../../bridge/herdr";
import { useMustr } from "../../state/store";
import { paneDisplayName } from "../../lib/names";
import { MENU_CONTENT, MENU_ITEM as ITEM, MENU_ITEM_DANGER, MENU_SEPARATOR, MENU_SHADOW } from "../ui/menu";

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
            className={MENU_CONTENT}
            style={MENU_SHADOW}
          >
            <ContextMenu.Item className={`${ITEM} text-text-primary`} onSelect={() => void split("right")}>
              Split right
            </ContextMenu.Item>
            <ContextMenu.Item className={`${ITEM} text-text-primary`} onSelect={() => void split("down")}>
              Split down
            </ContextMenu.Item>
            <ContextMenu.Separator className={MENU_SEPARATOR} />
            <ContextMenu.Item
              className={MENU_ITEM_DANGER}
              onSelect={() => setConfirmClose(true)}
            >
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
                className="rounded-lg bg-danger-soft px-3 py-1.5 text-[13px] font-medium text-danger transition-colors duration-100 active:scale-[0.97]"
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
