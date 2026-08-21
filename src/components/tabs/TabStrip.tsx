// Tab strip for the selected workspace — Cursor grammar: the Toolbar
// itself is the recessed band (one consistent color across its width) and
// tabs sit directly on it, the active one a flat light pill that slides.
// Always present — a single tab still carries the strip, because it holds
// the new-tab affordance and names what you're looking at. Closing a tab
// ends real processes, so it always confirms — Radix dialog,
// consequence-first.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, Reorder, useReducedMotion } from "motion/react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X } from "@phosphor-icons/react";
import { closeTab, moveTab, renameTab, type TabInfo } from "../../bridge/herdr";
import { closeAutoFocus } from "../../lib/modality";
import { useMustr } from "../../state/store";
import { MENU_CONTENT, MENU_ITEM, MENU_ITEM_DANGER, MENU_SEPARATOR, DIALOG_SHADOW, MENU_SHADOW, DIALOG_CONTENT, DIALOG_OVERLAY, BTN, BTN_DANGER } from "../ui/menu";
import { RenameDialog } from "../ui/RenameDialog";
import { Tip } from "../ui/Tip";
import { springPop } from "../../design/motion";

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
      <Dialog.Content className={DIALOG_CONTENT} style={DIALOG_SHADOW} onEscapeKeyDown={onDone}>
        <Dialog.Title className="text-[13px] font-semibold text-balance text-text-primary">
          Close tab {tab.label}?
        </Dialog.Title>
        <Dialog.Description className="mt-1 text-[13px] leading-snug text-pretty text-text-secondary">
          {consequence}
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
              void closeTab(tab.tab_id)
                .then(refresh)
                .finally(onDone);
            }}
            className={BTN_DANGER}
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
  const reduce = useReducedMotion();
  const [closing, setClosing] = useState<TabInfo | null>(null);
  const [renaming, setRenaming] = useState<TabInfo | null>(null);

  const pane = panes.find((p) => p.pane_id === selectedPaneId);
  const workspaceTabs = tabs.filter((t) => t.workspace_id === pane?.workspace_id);

  // Local visual order while dragging; resynced from the server otherwise.
  const [order, setOrder] = useState<string[]>([]);
  const dragging = useRef(false);
  const serverIds = workspaceTabs.map((t) => t.tab_id).join(",");
  useEffect(() => {
    if (!dragging.current) setOrder(serverIds ? serverIds.split(",") : []);
  }, [serverIds]);

  if (workspaceTabs.length === 0) return null;
  const byId = new Map(workspaceTabs.map((t) => [t.tab_id, t]));
  const orderedTabs = order.map((id) => byId.get(id)).filter(Boolean) as TabInfo[];

  return (
    <Reorder.Group
      axis="x"
      values={order}
      onReorder={setOrder}
      className="flex min-w-0 max-w-[50vw] items-center gap-0.5 overflow-x-auto"
      role="tablist"
      aria-label="Tabs"
      as="div"
    >
      {orderedTabs.map((tab) => {
        const active = tab.tab_id === selectedTabId;
        const busy = tab.agent_status === "working";
        const blocked = tab.agent_status === "blocked";
        return (
          <Reorder.Item
            key={tab.tab_id}
            value={tab.tab_id}
            as="div"
            className="shrink-0"
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            whileDrag={{ scale: 1.03, zIndex: 10 }}
            onDragStart={() => {
              dragging.current = true;
            }}
            onDragEnd={() => {
              dragging.current = false;
              const target = order.indexOf(tab.tab_id);
              if (target >= 0) void moveTab(tab.tab_id, target).then(refresh);
            }}
          >
          <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(tab.tab_id)}
              onAuxClick={(e) => {
                if (e.button === 1) setClosing(tab);
              }}
              className={`group relative flex h-6 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] tabular-nums outline-offset-[-2px] transition-[color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] ${
                active
                  ? "text-text-primary"
                  : "text-text-muted hover:bg-[rgb(255_255_255/0.05)] hover:text-text-secondary"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="tab-thumb"
                  transition={reduce ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }}
                  className="absolute inset-0 rounded-[6px] bg-[rgb(255_255_255/0.12)]"
                  aria-hidden
                />
              )}
              {busy && (
                <span
                  className="status-dot-working relative size-[5px] shrink-0 rounded-full bg-status-working"
                  aria-label="working"
                />
              )}
              <AnimatePresence initial={false}>
                {blocked && (
                  <motion.span
                    key="blocked"
                    initial={reduce ? false : { scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={reduce ? { opacity: 0 } : { scale: 0.8, opacity: 0 }}
                    transition={reduce ? { duration: 0 } : springPop}
                    className="relative size-[5px] shrink-0 rounded-full bg-status-blocked"
                    aria-label="needs input"
                  />
                )}
              </AnimatePresence>
              <span className="relative max-w-[120px] truncate">{tab.label}</span>
              <span
                role="button"
                aria-label={`Close tab ${tab.label}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  setClosing(tab);
                }}
                className="relative -mr-1 flex size-4 shrink-0 items-center justify-center rounded-[4px] text-text-muted opacity-0 transition-[opacity,background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] group-hover:opacity-100 hover:bg-[rgb(255_255_255/0.1)] hover:text-text-primary"
              >
                <X size={9} weight="bold" aria-hidden />
              </span>
            </button>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content onCloseAutoFocus={closeAutoFocus} className={MENU_CONTENT} style={MENU_SHADOW}>
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
          </Reorder.Item>
        );
      })}
      <Tip label="New tab">
        <button
          type="button"
          onClick={() => void newTerminal()}
          aria-label="New tab"
          className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted transition-[color,background-color,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[rgb(255_255_255/0.04)] hover:text-text-primary active:scale-[0.97]"
        >
          <Plus size={13} weight="light" aria-hidden />
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
    </Reorder.Group>
  );
}

