// Shared close-pane confirmation (context menu and ⌘W both land here).
// Herdr vocabulary, consequence-first copy.

import * as Dialog from "@radix-ui/react-dialog";
import { closePane } from "../../bridge/herdr";
import { useMustr } from "../../state/store";
import { cwdFolder, prettyAgent } from "../../lib/names";
import { BTN, BTN_DANGER, DIALOG_CONTENT, DIALOG_OVERLAY, DIALOG_SHADOW } from "../ui/menu";

export function ClosePaneDialog({
  paneId,
  onOpenChange,
}: {
  paneId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { refresh, panes } = useMustr();
  const pane = panes.find((p) => p.pane_id === paneId);

  return (
    <Dialog.Root open={paneId !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content className={DIALOG_CONTENT} style={DIALOG_SHADOW}>
          <Dialog.Title className="text-[13px] font-semibold text-balance text-text-primary">
            {pane?.agent ? "Close this agent?" : "Close this pane?"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[13px] leading-snug text-pretty text-text-secondary">
            {pane?.agent
              ? `${prettyAgent(pane.agent)} in ${cwdFolder(pane.cwd)} will end, along with anything it's running.`
              : `The shell in ${pane ? cwdFolder(pane.cwd) : "this pane"} will end, along with anything it's running.`}
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className={BTN}>
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              autoFocus
              onClick={() => {
                if (paneId) {
                  void closePane(paneId)
                    .then(refresh)
                    .finally(() => onOpenChange(false));
                }
              }}
              className={BTN_DANGER}
            >
              {pane?.agent ? "Close agent" : "Close pane"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
