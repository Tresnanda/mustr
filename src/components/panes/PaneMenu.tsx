// Right-click actions for a pane — mouse-first, like herdr itself.
// Splitting targets the clicked pane (focused first, since the server splits
// the focused pane); closing always confirms with the consequence stated.

import { useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { focusPane, splitPane, zoomPane } from "../../bridge/herdr";
import { closeAutoFocus } from "../../lib/modality";
import { useMustr } from "../../state/store";
import { MENU_CONTENT, MENU_ITEM as ITEM, MENU_ITEM_DANGER, MENU_SEPARATOR, MENU_SHADOW } from "../ui/menu";
import { ClosePaneDialog } from "./ClosePaneDialog";

export function PaneMenu({ paneId, children }: { paneId: string; children: React.ReactNode }) {
  const { refresh, selectPane, panes, layouts } = useMustr();
  const [confirmClose, setConfirmClose] = useState(false);
  const pane = panes.find((p) => p.pane_id === paneId);
  const zoomed = layouts.find((l) => l.tab_id === pane?.tab_id)?.zoomed ?? false;

  const toggleZoom = async () => {
    await focusPane(paneId).catch(() => {});
    selectPane(paneId);
    await zoomPane(paneId).catch(() => {});
    await refresh();
  };

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
            onCloseAutoFocus={closeAutoFocus}
            className={MENU_CONTENT}
            style={MENU_SHADOW}
          >
            <ContextMenu.Item className={`${ITEM} text-text-primary`} onSelect={() => void split("right")}>
              Split right
            </ContextMenu.Item>
            <ContextMenu.Item className={`${ITEM} text-text-primary`} onSelect={() => void split("down")}>
              Split down
            </ContextMenu.Item>
            <ContextMenu.Item className={`${ITEM} text-text-primary`} onSelect={() => void toggleZoom()}>
              {zoomed ? "Exit zoom" : "Zoom pane"}
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

      <ClosePaneDialog
        paneId={confirmClose ? paneId : null}
        onOpenChange={(open) => setConfirmClose(open)}
      />
    </>
  );
}
