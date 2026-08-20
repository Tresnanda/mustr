// Right-click actions for a pane — mouse-first, like herdr itself.
// Splitting targets the clicked pane (focused first, since the server splits
// the focused pane); closing always confirms with the consequence stated.

import { useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { closePane, focusPane, splitPane } from "../../bridge/herdr";
import { useMustr } from "../../state/store";
import { cwdFolder, prettyAgent } from "../../lib/names";
import { MENU_CONTENT, MENU_ITEM as ITEM, MENU_ITEM_DANGER, MENU_SEPARATOR, MENU_SHADOW, DIALOG_CONTENT, DIALOG_OVERLAY } from "../ui/menu";

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
              {pane?.agent ? "Close agent" : "Close pane"}
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Dialog.Root open={confirmClose} onOpenChange={setConfirmClose}>
        <Dialog.Portal>
          <Dialog.Overlay className={DIALOG_OVERLAY} />
          <Dialog.Content className={DIALOG_CONTENT} style={MENU_SHADOW}>
            <Dialog.Title className="text-[13px] font-semibold text-text-primary">
              {pane?.agent ? "Close this agent?" : "Close this pane?"}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-[13px] leading-snug text-text-secondary">
              {pane?.agent
                ? `${prettyAgent(pane.agent)} in ${cwdFolder(pane.cwd)} will end, along with anything it's running.`
                : `The shell in ${pane ? cwdFolder(pane.cwd) : "this pane"} will end, along with anything it's running.`}
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
                {pane?.agent ? "Close agent" : "Close pane"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
