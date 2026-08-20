// Ink source list. Agents grouped by status (Needs input → Working → Done →
// Idle) because "never hunt for the stuck one" is the product. Terminals are
// not enumerated globally: they nest under a space when that space is scoped,
// like herdr itself. Selection is instant — no traveling indicator.

import React, { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Folder, FolderPlus, Folders, FunnelSimple, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { statusSince, useMustr } from "../../state/store";
import type { AgentStatus, PaneInfo } from "../../bridge/herdr";
import { StatusIcon, STATUS_LABEL } from "../status";
import { cwdFolder, paneDetail, paneDisplayName } from "../../lib/names";
import { relativeAge } from "../../lib/time";
import { DevicePill } from "./DevicePill";
import { dragHandlers } from "../DragRegion";
import { SpaceMenu } from "./SpaceMenu";
import { Tip } from "../ui/Tip";

const AGENT_GROUPS: AgentStatus[] = ["blocked", "working", "done", "idle"];
const GROUP_TITLE: Record<AgentStatus, string> = {
  blocked: "Needs input",
  working: "Working",
  done: "Done",
  idle: "Idle",
  unknown: "Shell",
};

function SectionHeader({
  children,
  actions,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <h2 className="flex h-8 items-end px-2 pb-1 text-[12px] font-medium text-text-muted">
      <span className="flex-1">{children}</span>
      {actions && <span className="flex items-center gap-0.5">{actions}</span>}
    </h2>
  );
}

function HeaderButton({
  onClick,
  label,
  active,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex size-6 items-center justify-center rounded-md transition-colors duration-100 hover:bg-hover active:scale-[0.96] ${
        active ? "bg-active text-text-primary" : "text-text-muted"
      }`}
    >
      {children}
    </button>
  );
}

interface RowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  label: string;
  tall?: boolean;
  indent?: boolean;
}

/** Forwards unknown props/ref so Radix asChild triggers (context menus,
    tooltips) can attach their handlers. */
const Row = React.forwardRef<HTMLButtonElement, RowProps>(function Row(
  { selected, label, tall, indent, children, className: _ignored, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      {...rest}
      className={`flex w-full items-center gap-2.5 rounded-lg text-left outline-offset-[-2px] transition-colors duration-100 ${
        selected ? "bg-selection" : "hover:bg-hover"
      } ${tall ? "py-[7px]" : "h-8"} ${indent ? "pl-8 pr-2" : "px-2"}`}
    >
      {children}
    </button>
  );
});

function AgentRow({ pane, selected, now }: { pane: PaneInfo; selected: boolean; now: number }) {
  const selectPane = useMustr((s) => s.selectPane);
  const workspaces = useMustr((s) => s.workspaces);
  const name = paneDisplayName(pane);
  const detail = paneDetail(pane);
  const space = workspaces.find((w) => w.workspace_id === pane.workspace_id)?.label;
  const age = relativeAge(statusSince.get(pane.pane_id), now);

  return (
    <Row
      onClick={() => selectPane(pane.pane_id)}
      selected={selected}
      label={`${name}, ${STATUS_LABEL[pane.agent_status]}${age ? `, ${age}` : ""}`}
      tall
    >
      <span className="flex w-5 shrink-0 justify-center">
        <StatusIcon status={pane.agent_status} size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
            {detail !== name ? detail : name}
          </span>
          <span className="shrink-0 text-[11.5px] tabular-nums text-text-muted">{age}</span>
        </span>
        <span className="mt-px block truncate text-[12px] text-text-secondary">
          {pane.agent}
          {space ? <span className="text-text-muted"> · {space}</span> : null}
        </span>
      </span>
    </Row>
  );
}

export function Sidebar() {
  const {
    workspaces,
    panes,
    selectedPaneId,
    scopeId,
    filter,
    now,
    setScope,
    setFilter,
    newTerminal,
  } = useMustr();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const scoped = useMemo(() => {
    let list = scopeId ? panes.filter((p) => p.workspace_id === scopeId) : panes;
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter(
        (p) =>
          paneDisplayName(p).toLowerCase().includes(q) ||
          paneDetail(p).toLowerCase().includes(q),
      );
    }
    return list;
  }, [panes, scopeId, filter]);

  const agentsByStatus = useMemo(() => {
    const groups = new Map<AgentStatus, PaneInfo[]>();
    for (const status of AGENT_GROUPS) groups.set(status, []);
    for (const p of scoped) {
      if (!p.agent) continue;
      groups.get(p.agent_status === "unknown" ? "idle" : p.agent_status)?.push(p);
    }
    return groups;
  }, [scoped]);

  // Terminals for one space, nested under its row when scoped.
  const nestedTerminals = (workspaceId: string): PaneInfo[] =>
    scopeId === workspaceId ? scoped.filter((p) => !p.agent) : [];

  const selectPane = useMustr((s) => s.selectPane);
  const git = useMustr((s) => s.git);
  const hideQuiet = useMustr((s) => s.hideQuiet);
  const toggleHideQuiet = useMustr((s) => s.toggleHideQuiet);
  const newSpace = useMustr((s) => s.newSpace);

  const pickFolderForSpace = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "New space folder" });
    if (typeof dir === "string" && dir) await newSpace(dir);
  };

  return (
    <div className="flex h-full flex-col">
      <div {...dragHandlers()} className="h-[52px] shrink-0" />

      <div className="px-3">
        <Row onClick={() => void newTerminal()} label="New terminal">
          <Plus size={15} className="shrink-0 text-text-secondary" aria-hidden />
          <span className="text-[13px] text-text-primary">New Terminal</span>
        </Row>
        {searchOpen ? (
          <div className="flex h-8 items-center gap-2.5 rounded-lg border border-border-subtle bg-inset px-2 transition-colors duration-100 focus-within:border-border-strong">
            <MagnifyingGlass size={15} className="shrink-0 text-text-secondary" aria-hidden />
            <input
              ref={searchRef}
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setFilter("");
                  setSearchOpen(false);
                }
              }}
              onBlur={() => {
                if (!filter.trim()) setSearchOpen(false);
              }}
              placeholder="Agent or folder name"
              aria-label="Search panes"
              style={{ outline: "none", boxShadow: "none", WebkitAppearance: "none" }}
              className="w-full appearance-none border-0 bg-transparent text-[13px] text-text-primary placeholder:text-text-muted"
            />
          </div>
        ) : (
          <Row onClick={() => setSearchOpen(true)} label="Search panes">
            <MagnifyingGlass size={15} className="shrink-0 text-text-secondary" aria-hidden />
            <span className="text-[13px] text-text-primary">Search</span>
          </Row>
        )}
      </div>

      <nav aria-label="Spaces and agents" className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <SectionHeader
          actions={
            <>
              <Tip label={hideQuiet ? "Show done and idle agents" : "Hide done and idle agents"}>
                <HeaderButton
                  onClick={toggleHideQuiet}
                  label={hideQuiet ? "Show done and idle agents" : "Hide done and idle agents"}
                  active={hideQuiet}
                >
                  <FunnelSimple size={14} aria-hidden />
                </HeaderButton>
              </Tip>
              <Tip label="New space from folder">
                <HeaderButton onClick={() => void pickFolderForSpace()} label="New space from folder">
                  <FolderPlus size={14} aria-hidden />
                </HeaderButton>
              </Tip>
            </>
          }
        >
          Spaces
        </SectionHeader>
        <div className="flex flex-col gap-[3px]">
        <Row
          onClick={() => setScope(null)}
          selected={scopeId === null}
          label={`All spaces, ${workspaces.length}`}
        >
          <Folders size={15} className="shrink-0 text-text-secondary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">All Spaces</span>
          <span className="text-[12px] tabular-nums text-text-muted">{workspaces.length}</span>
        </Row>
        {workspaces.map((ws) => {
          const terminals = nestedTerminals(ws.workspace_id);
          const seen = new Map<string, number>();
          const totals = new Map<string, number>();
          for (const p of terminals) {
            const k = cwdFolder(p.cwd) ?? p.pane_id;
            totals.set(k, (totals.get(k) ?? 0) + 1);
          }
          return (
            <div key={ws.workspace_id}>
              <SpaceMenu workspace={ws}>
              {(() => {
                const cwd = panes.find((p) => p.workspace_id === ws.workspace_id)?.cwd;
                const info = cwd ? git[cwd] : undefined;
                return (
                  <Row
                    onClick={() => setScope(scopeId === ws.workspace_id ? null : ws.workspace_id)}
                    selected={scopeId === ws.workspace_id}
                    label={`Space ${ws.label}, ${ws.pane_count} panes${info ? `, on ${info.branch}` : ""}`}
                    tall={Boolean(info)}
                  >
                    <Folder size={15} className="shrink-0 text-text-secondary" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                          {ws.label}
                        </span>
                        <span className="shrink-0 text-[12px] tabular-nums text-text-muted">
                          {ws.pane_count}
                        </span>
                      </span>
                      {info && (
                        <span className="mt-px block truncate font-mono text-[11px] leading-tight text-text-muted">
                          {info.branch}
                          {info.dirty ? "*" : ""}
                        </span>
                      )}
                    </span>
                  </Row>
                );
              })()}
              </SpaceMenu>
              {terminals.map((pane) => {
                const k = cwdFolder(pane.cwd) ?? pane.pane_id;
                const n = (seen.get(k) ?? 0) + 1;
                seen.set(k, n);
                const many = (totals.get(k) ?? 1) > 1;
                return (
                  <Row
                    key={pane.pane_id}
                    onClick={() => selectPane(pane.pane_id)}
                    selected={pane.pane_id === selectedPaneId}
                    label={`Terminal in ${k}${many ? ` ${n}` : ""}`}
                    indent
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">
                      {k}
                      {many && (
                        <span className="ml-1.5 text-[12px] tabular-nums text-text-muted">{n}</span>
                      )}
                    </span>
                  </Row>
                );
              })}
            </div>
          );
        })}

        </div>

        {AGENT_GROUPS.map((status) => {
          const group = agentsByStatus.get(status) ?? [];
          if (group.length === 0) return null;
          if (hideQuiet && (status === "done" || status === "idle")) return null;
          return (
            <div key={status} className="mt-3">
              <SectionHeader>{GROUP_TITLE[status]}</SectionHeader>
              <div className="flex flex-col gap-[3px]">
              <AnimatePresence initial={false}>
                {group.map((pane) => (
                  <motion.div
                    key={pane.pane_id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                  >
                    <AgentRow pane={pane} selected={pane.pane_id === selectedPaneId} now={now} />
                  </motion.div>
                ))}
              </AnimatePresence>
              </div>
            </div>
          );
        })}

        {scoped.length === 0 && (
          <p className="px-2 pt-3 text-[12px] leading-snug text-text-secondary">
            {filter
              ? `No panes match “${filter}”.`
              : "Nothing running here yet. Create one with New Terminal."}
          </p>
        )}
      </nav>

      <DevicePill />
    </div>
  );
}
