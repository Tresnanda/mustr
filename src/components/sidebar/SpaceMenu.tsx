// Right-click actions for a space row: new tab, rename, close — with
// consequence-first confirmation for close.

import { useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { closeWorkspace, createTab, renameWorkspace, type WorkspaceInfo } from "../../bridge/herdr";
import { useMustr } from "../../state/store";
import { MENU_CONTENT, MENU_ITEM, MENU_ITEM_DANGER, MENU_SEPARATOR, MENU_SHADOW, DIALOG_CONTENT, DIALOG_OVERLAY } from "../ui/menu";
import { RenameDialog } from "../ui/RenameDialog";

export function SpaceMenu({
  workspace,
  children,
}: {
  workspace: WorkspaceInfo;
  children: React.ReactNode;
}) {
  const { refresh, selectTab } = useMustr();
  const [renaming, setRenaming] = useState(false);
  const [closing, setClosing] = useState(false);
  const consequence =
    workspace.pane_count === 1
      ? "Its pane will close and anything it's running will end."
      : `Its ${workspace.pane_count} panes will close and anything they're running will end.`;

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={MENU_CONTENT} style={MENU_SHADOW}>
            <ContextMenu.Item
              className={`${MENU_ITEM} text-text-primary`}
              onSelect={() => {
                void createTab(workspace.workspace_id).then((r) => {
                  if (r.tab) selectTab(r.tab.tab_id);
                  void refresh();
                });
              }}
            >
              New tab in {workspace.label}
            </ContextMenu.Item>
            <ContextMenu.Item
              className={`${MENU_ITEM} text-text-primary`}
              onSelect={() => setRenaming(true)}
            >
              Rename space…
            </ContextMenu.Item>
            <ContextMenu.Separator className={MENU_SEPARATOR} />
            <ContextMenu.Item
              className={MENU_ITEM_DANGER}
              onSelect={() => setClosing(true)}
            >
              Close space
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <RenameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={`Rename ${workspace.label}`}
        initial={workspace.label}
        onRename={(label) => void renameWorkspace(workspace.workspace_id, label).then(refresh)}
      />

      <Dialog.Root open={closing} onOpenChange={setClosing}>
        <Dialog.Portal>
          <Dialog.Overlay className={DIALOG_OVERLAY} />
          <Dialog.Content className={DIALOG_CONTENT} style={MENU_SHADOW}>
            <Dialog.Title className="text-[13px] font-semibold text-text-primary">
              Close space {workspace.label}?
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-[13px] leading-snug text-text-secondary">
              {consequence}
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
                  void closeWorkspace(workspace.workspace_id)
                    .then(refresh)
                    .finally(() => setClosing(false));
                }}
                className="rounded-lg bg-danger-soft px-3 py-1.5 text-[13px] font-medium text-danger transition-colors duration-100 active:scale-[0.97]"
              >
                Close space
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
