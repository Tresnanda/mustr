// Right-click actions for a space row: new tab, rename, close — with
// consequence-first confirmation for close.

import { useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { closeWorkspace, createTab, createWorktree, removeWorktree, renameWorkspace, type WorkspaceInfo } from "../../bridge/herdr";
import { closeAutoFocus } from "../../lib/modality";
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
  const { refresh, selectTab, panes } = useMustr();
  const [renaming, setRenaming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [branching, setBranching] = useState(false);
  const [branch, setBranch] = useState("");
  const [branchError, setBranchError] = useState<string | null>(null);
  const [removingWorktree, setRemovingWorktree] = useState(false);
  const isWorktree = panes.some(
    (p) => p.workspace_id === workspace.workspace_id && p.cwd.includes("/.herdr/worktrees/"),
  );

  const makeWorktree = async () => {
    const name = branch.trim();
    if (!name || /\s/.test(name)) {
      setBranchError("Branch names can't contain spaces.");
      return;
    }
    try {
      await createWorktree(workspace.workspace_id, name);
      await refresh();
      setBranching(false);
      setBranch("");
      setBranchError(null);
    } catch (e) {
      setBranchError(String(e));
    }
  };
  const consequence =
    workspace.pane_count === 1
      ? "Its pane will close and anything it's running will end."
      : `Its ${workspace.pane_count} panes will close and anything they're running will end.`;

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content onCloseAutoFocus={closeAutoFocus} className={MENU_CONTENT} style={MENU_SHADOW}>
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
            <ContextMenu.Item
              className={`${MENU_ITEM} text-text-primary`}
              onSelect={() => setBranching(true)}
            >
              New linked worktree…
            </ContextMenu.Item>
            {isWorktree && (
              <ContextMenu.Item
                className={MENU_ITEM_DANGER}
                onSelect={() => setRemovingWorktree(true)}
              >
                Remove worktree
              </ContextMenu.Item>
            )}
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

      <Dialog.Root open={branching} onOpenChange={(o) => { setBranching(o); if (!o) setBranchError(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className={DIALOG_OVERLAY} />
          <Dialog.Content className={DIALOG_CONTENT} style={MENU_SHADOW}>
            <Dialog.Title className="text-[13px] font-semibold text-text-primary">
              New linked worktree
            </Dialog.Title>
            <Dialog.Description className="mt-1.5 text-[13px] leading-snug text-text-secondary">
              A second checkout of {workspace.label} on its own branch, opened as a
              new space — agents there can't collide with this one.
            </Dialog.Description>
            <label className="mt-4 block text-[12px] font-medium text-text-secondary">
              Branch name
              <input
                autoFocus
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void makeWorktree();
                }}
                placeholder="fix/scroll-jitter"
                style={{ outline: "none" }}
                className="mt-1.5 h-8 w-full rounded-lg border border-border-subtle bg-inset px-2.5 font-mono text-[12px] text-text-primary transition-colors duration-100 focus:border-border-strong"
              />
            </label>
            <p className="mt-1.5 text-[11.5px] text-text-muted">
              Branches from the space's current branch.
            </p>
            {branchError && (
              <p className="mt-2 text-[12px] leading-snug text-danger">{branchError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
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
                onClick={() => void makeWorktree()}
                className="rounded-lg bg-selection px-3 py-1.5 text-[13px] font-medium text-text-primary transition-colors duration-100 hover:bg-active active:scale-[0.97]"
              >
                Create worktree
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={removingWorktree} onOpenChange={setRemovingWorktree}>
        <Dialog.Portal>
          <Dialog.Overlay className={DIALOG_OVERLAY} />
          <Dialog.Content className={DIALOG_CONTENT} style={MENU_SHADOW}>
            <Dialog.Title className="text-[13px] font-semibold text-text-primary">
              Remove worktree {workspace.label}?
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-[13px] leading-snug text-text-secondary">
              {consequence} The worktree folder is deleted; its branch and commits stay
              in the repo.
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
                  void removeWorktree(workspace.workspace_id)
                    .then(refresh)
                    .finally(() => setRemovingWorktree(false));
                }}
                className="rounded-lg bg-danger-soft px-3 py-1.5 text-[13px] font-medium text-danger transition-colors duration-100 active:scale-[0.97]"
              >
                Remove worktree
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

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
