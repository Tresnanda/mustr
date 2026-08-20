// Tab strip for the selected workspace. Hidden when the workspace has a
// single tab (chrome earns its place). Closing a tab ends real processes,
// so it always confirms — through a Radix dialog, consequence-first.

import { useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X } from "@phosphor-icons/react";
import { closeTab, renameTab, type TabInfo } from "../../bridge/herdr";
import { useMustr } from "../../state/store";
import { MENU_CONTENT, MENU_ITEM, MENU_ITEM_DANGER, MENU_SEPARATOR, MENU_SHADOW, DIALOG_CONTENT, DIALOG_OVERLAY } from "../ui/menu";
import { RenameDialog } from "../ui/RenameDialog";
import { Tip } from "../ui/Tip";

function CloseTabDialog({
  tab,
  onDone,
}: {
  tab: TabInfo;
  onDone: () => void;
}) {
  const refresh = useMustr((s) => s.refresh);
  const consequence =
    tab.pane_count === 1
      ? "Its terminal will close and anything it's running will end."
      : `Its ${tab.pane_count} terminals will close and anything they're running will end.`;
  return (
    <Dialog.Portal>
      <Dialog.Overlay className={DIALOG_OVERLAY} />
      <Dialog.Content className={DIALOG_CONTENT} style={MENU_SHADOW} onEscapeKeyDown={onDone}>
        <Dialog.Title className="text-[13px] font-semibold text-text-primary">
          Close tab {tab.label}?
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
              void closeTab(tab.tab_id)
                .then(refresh)
                .finally(onDone);
            }}
            className="rounded-lg bg-danger-soft px-3 py-1.5 text-[13px] font-medium text-danger transition-colors duration-100 active:scale-[0.97]"
          >
            Close tab
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function TabStrip() {
  const { tabs, selectedTabId, selectTab, newTerminal, panes, selectedPaneId, refresh } = useMustr();
  const [closing, setClosing] = useState<TabInfo | null>(null);
  const [renaming, setRenaming] = useState<TabInfo | null>(null);

  const pane = panes.find((p) => p.pane_id === selectedPaneId);
  const workspaceTabs = tabs.filter((t) => t.workspace_id === pane?.workspace_id);
  if (workspaceTabs.length <= 1) return null;

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 px-3">
      {workspaceTabs.map((tab) => {
        const active = tab.tab_id === selectedTabId;
        return (
          <ContextMenu.Root key={tab.tab_id}>
          <ContextMenu.Trigger asChild>
          <div
            className={`group flex h-7 items-center rounded-lg transition-colors duration-100 ${
              active ? "bg-selection" : "hover:bg-hover"
            }`}
          >
            <button
              type="button"
              onClick={() => selectTab(tab.tab_id)}
              aria-current={active ? "true" : undefined}
              className={`h-full pl-3 pr-1.5 text-[12.5px] ${
                active ? "font-medium text-text-primary" : "text-text-secondary"
              }`}
            >
              {tab.label}
            </button>
            <button
              type="button"
              onClick={() => setClosing(tab)}
              aria-label={`Close tab ${tab.label}`}
              className="mr-1 flex size-5 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity duration-100 hover:bg-hover hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X size={11} aria-hidden />
            </button>
          </div>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content className={MENU_CONTENT} style={MENU_SHADOW}>
              <ContextMenu.Item
                className={`${MENU_ITEM} text-text-primary`}
                onSelect={() => setRenaming(tab)}
              >
                Rename tab…
              </ContextMenu.Item>
              <ContextMenu.Separator className={MENU_SEPARATOR} />
              <ContextMenu.Item
                className={MENU_ITEM_DANGER}
                onSelect={() => setClosing(tab)}
              >
                Close tab
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
          </ContextMenu.Root>
        );
      })}
      <Tip label="New tab">
        <button
          type="button"
          onClick={() => void newTerminal()}
          aria-label="New tab"
          className="flex size-7 items-center justify-center rounded-lg text-text-muted transition-colors duration-100 hover:bg-hover hover:text-text-primary active:scale-[0.96]"
        >
          <Plus size={13} aria-hidden />
        </button>
      </Tip>

      <Dialog.Root open={closing !== null} onOpenChange={(open) => !open && setClosing(null)}>
        {closing && <CloseTabDialog tab={closing} onDone={() => setClosing(null)} />}
      </Dialog.Root>
      {renaming && (
        <RenameDialog
          open
          onOpenChange={(open) => !open && setRenaming(null)}
          title={`Rename tab ${renaming.label}`}
          initial={renaming.label}
          onRename={(label) => void renameTab(renaming.tab_id, label).then(refresh)}
        />
      )}
    </div>
  );
}
