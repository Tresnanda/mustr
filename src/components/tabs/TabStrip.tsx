// Tab strip for the selected workspace. Hidden when the workspace has a
// single tab (chrome earns its place). Closing a tab ends real processes,
// so it always confirms — through a Radix dialog, consequence-first.

import { useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus } from "@phosphor-icons/react";
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
      ? "Its pane will close and anything it's running will end."
      : `Its ${tab.pane_count} panes will close and anything they're running will end.`;
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
  if (workspaceTabs.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-1" role="tablist" aria-label="Tabs">
      <div className="flex max-w-[420px] items-center gap-[2px] overflow-x-auto rounded-[7px] bg-[rgb(0_0_0/0.22)] p-[2px]">
      {workspaceTabs.map((tab) => {
        const active = tab.tab_id === selectedTabId;
        const busy = tab.agent_status === "working";
        const blocked = tab.agent_status === "blocked";
        return (
          <ContextMenu.Root key={tab.tab_id}>
          <ContextMenu.Trigger asChild>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(tab.tab_id)}
              onAuxClick={(e) => {
                if (e.button === 1) setClosing(tab);
              }}
              className={`flex h-[22px] min-w-[40px] shrink-0 items-center justify-center gap-1.5 rounded-[5px] px-3 text-[12px] tabular-nums outline-offset-[-2px] transition-colors duration-100 ${
                active
                  ? "bg-[rgb(255_255_255/0.14)] font-medium text-text-primary shadow-[0_0_0_0.5px_rgb(255_255_255/0.07)]"
                  : "text-text-secondary hover:bg-[rgb(255_255_255/0.05)]"
              }`}
            >
              {busy && (
                <span className="status-dot-working size-[5px] shrink-0 rounded-full bg-status-working" aria-label="working" />
              )}
              {blocked && (
                <span className="size-[5px] shrink-0 rounded-full bg-status-blocked" aria-label="needs input" />
              )}
              <span className="max-w-[96px] truncate">{tab.label}</span>
            </button>
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
      </div>
      <Tip label="New tab">
        <button
          type="button"
          onClick={() => void newTerminal()}
          aria-label="New tab"
          className="flex size-[26px] shrink-0 items-center justify-center rounded-[6px] text-text-muted transition-colors duration-100 hover:bg-hover hover:text-text-primary active:scale-[0.96]"
        >
          <Plus size={12} aria-hidden />
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
