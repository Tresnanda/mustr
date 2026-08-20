// Right-click actions for a space row: new tab, rename, close — with
// consequence-first confirmation for close.

import { useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, PencilSimple, X } from "@phosphor-icons/react";
import { closeWorkspace, createTab, renameWorkspace, type WorkspaceInfo } from "../../bridge/herdr";
import { useMustr } from "../../state/store";
import { MENU_CONTENT, MENU_ITEM, MENU_SEPARATOR, MENU_SHADOW } from "../ui/menu";
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
  const terminals =
    workspace.pane_count === 1 ? "its terminal" : `its ${workspace.pane_count} terminals`;

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
              <Plus size={14} className="text-text-secondary" aria-hidden />
              New tab in {workspace.label}
            </ContextMenu.Item>
            <ContextMenu.Item
              className={`${MENU_ITEM} text-text-primary`}
              onSelect={() => setRenaming(true)}
            >
              <PencilSimple size={14} className="text-text-secondary" aria-hidden />
              Rename space…
            </ContextMenu.Item>
            <ContextMenu.Separator className={MENU_SEPARATOR} />
            <ContextMenu.Item
              className={`${MENU_ITEM} text-danger`}
              onSelect={() => setClosing(true)}
            >
              <X size={14} aria-hidden />
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
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-sidebar p-5"
            style={MENU_SHADOW}
          >
            <Dialog.Title className="text-[13px] font-semibold text-text-primary">
              Close space {workspace.label}?
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-[13px] leading-snug text-text-secondary">
              Anything running in {terminals} will end.
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
