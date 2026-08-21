// Ink source list. Spaces first (where you are), agents below as one flat
// list. Attention order sorts Needs input → Working → Done → Idle and a
// wider gap separates the runs, so the stuck one is never buried without
// a status sub-header layer — each row's status icon carries the state.
// Grouping by space keeps labels, since there the label is the information.
// Terminals nest under a space when that space is scoped, like herdr
// itself. One selected row at a time — no stacked fills.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, Reorder, useReducedMotion } from "motion/react";
import { CaretDown, Folder, FolderPlus, Folders, FunnelSimple, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { statusSince, useMustr, type AgentOrder, type AgentShow } from "../../state/store";
import { moveWorkspace } from "../../bridge/herdr";
import type { AgentStatus, PaneInfo } from "../../bridge/herdr";
import { StatusIcon, STATUS_LABEL } from "../status";
import { cwdFolder, paneDetail, paneDisplayName } from "../../lib/names";
import { relativeAge } from "../../lib/time";
import { DevicePill } from "./DevicePill";
import { SessionSwitcher } from "./SessionSwitcher";
import { dragHandlers } from "../DragRegion";
import { SpaceMenu } from "./SpaceMenu";
import { AgentFilterMenu, agentViewDirty } from "./AgentFilterMenu";
import { RemoteFolderDialog } from "./RemoteFolderDialog";
import { Tip } from "../ui/Tip";
import { springSettle } from "../../design/motion";

const AGENT_GROUPS: AgentStatus[] = ["blocked", "working", "done", "idle"];

function normStatus(status: AgentStatus): AgentStatus {
  return status === "unknown" ? "idle" : status;
}

function passesShow(status: AgentStatus, show: AgentShow): boolean {
  if (show === "all") return true;
  if (show === "active") return status !== "idle" && status !== "done";
  if (show === "hide-idle") return status !== "idle";
  if (show === "hide-done") return status !== "done";
  return true;
}

function sortAgents(list: PaneInfo[], order: AgentOrder): PaneInfo[] {
  const copy = [...list];
  if (order === "name") {
    copy.sort((a, b) => paneDisplayName(a).localeCompare(paneDisplayName(b)));
  } else if (order === "recent") {
    copy.sort((a, b) => (statusSince.get(b.pane_id) ?? 0) - (statusSince.get(a.pane_id) ?? 0));
  } else {
    copy.sort(
      (a, b) =>
        AGENT_GROUPS.indexOf(normStatus(a.agent_status)) - AGENT_GROUPS.indexOf(normStatus(b.agent_status)),
    );
  }
  return copy;
}

/** Glyph | copy | meta. One grid for every header and row so edges don't drift. */
const COLS = "grid-cols-[1.25rem_minmax(0,1fr)_2rem] gap-x-2.5 px-2.5";
/** Trailing slot: counts and header actions share this box and one center
    axis, so a centered icon button lines up over the digits below it. */
const META = "flex w-8 items-center justify-center";

function SectionHeader({
  children,
  actions,
  open,
  onToggle,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  open?: boolean;
  onToggle?: () => void;
}) {
  const label = (
    <span className="flex min-w-0 items-center gap-1">
      <span className="min-w-0 truncate">{children}</span>
      {onToggle && (
        <CaretDown
          size={10}
          weight="bold"
          className="fold-caret shrink-0"
          data-open={open ? "" : undefined}
          aria-hidden
        />
      )}
    </span>
  );
  return (
    <h2 className={`grid h-7 ${COLS} items-center text-[12px] font-semibold tracking-[0.01em] text-text-secondary`}>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="col-span-2 flex min-w-0 items-center rounded-md text-left transition-[color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-text-primary"
          aria-label={open ? `Hide ${children}` : `Show ${children}`}
        >
          {label}
        </button>
      ) : (
        <span className="col-span-2 min-w-0 truncate">{children}</span>
      )}
      {actions && <span className={META}>{actions}</span>}
    </h2>
  );
}

function Fold({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className="section-fold" data-open={open ? "" : undefined}>
      <div className="section-fold-inner">{children}</div>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className={`grid h-6 ${COLS} items-center text-[11px] font-medium text-text-muted`}>
      <span className="col-start-2 min-w-0 truncate">{children}</span>
    </h3>
  );
}

/** Spreads rest props so Radix asChild wrappers (Dropdown.Trigger, Tip)
    can inject their handlers and state attributes. Own className wins. */
const HeaderButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    active?: boolean;
  }
>(function HeaderButton({ label, active, children, className: _ignored, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      {...rest}
      className={`flex size-7 items-center justify-center rounded-lg transition-[color,background-color,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover active:scale-[0.96] data-[state=open]:bg-hover data-[state=open]:text-text-primary ${
        active ? "bg-active text-text-primary" : "text-text-muted"
      }`}
    >
      {children}
    </button>
  );
});

interface RowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  label: string;
  tall?: boolean;
  press?: boolean;
}

/** Three columns: glyph | copy | meta. Subtitles stay in copy so they
    never run under the count. Forwards ref for Radix asChild triggers. */
const Row = React.forwardRef<HTMLButtonElement, RowProps>(function Row(
  { selected, label, tall, press, children, className: _ignored, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      {...rest}
      className={`group grid w-full ${COLS} rounded-lg text-left outline-offset-[-2px] transition-[color,background-color,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)] ${
        selected ? "bg-selection" : "hover:bg-hover"
      } ${press ? "active:scale-[0.96]" : ""} ${
        tall ? "items-start py-1.5" : "h-8 items-center"
      }`}
    >
      {children}
    </button>
  );
});

function RowGlyph({ children }: { children?: React.ReactNode }) {
  return (
    <span className="flex size-5 items-center justify-center text-text-secondary" aria-hidden>
      {children}
    </span>
  );
}

/** Text meta (counts, ages) aligns with the title line in tall rows; pass
    `center` for whole-row affordances like the disclosure chevron, which
    platform grammar centers on the full cell height. */
function RowMeta({ children, center }: { children?: React.ReactNode; center?: boolean }) {
  return (
    <span className={`${META} text-[11px] tabular-nums text-text-muted ${center ? "self-stretch" : ""}`}>
      {children}
    </span>
  );
}

function NestedTerminals({
  open,
  terminals,
  selectedPaneId,
  onSelect,
}: {
  open: boolean;
  terminals: PaneInfo[];
  selectedPaneId: string | null;
  onSelect: (paneId: string) => void;
}) {
  // Keep the last open list mounted so collapse can clip-close instead of
  // unmounting (instant display:none). Skip the first paint so a restored
  // scope doesn't play an entrance.
  const cache = useRef(terminals);
  if (open) cache.current = terminals;
  const list = cache.current;
  const [live, setLive] = useState(false);
  useEffect(() => {
    setLive(true);
  }, []);
  const seen = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const p of list) {
    const k = cwdFolder(p.cwd) ?? p.pane_id;
    totals.set(k, (totals.get(k) ?? 0) + 1);
  }

  return (
    <div
      className="space-nest"
      data-open={open && list.length > 0 ? "" : undefined}
      data-instant={live ? undefined : ""}
    >
      <div className="space-nest-inner">
        <div className="flex flex-col gap-0.5 pt-0.5">
          {list.map((pane) => {
            const k = cwdFolder(pane.cwd) ?? pane.pane_id;
            const n = (seen.get(k) ?? 0) + 1;
            seen.set(k, n);
            const many = (totals.get(k) ?? 1) > 1;
            return (
              <Row
                key={pane.pane_id}
                onClick={() => onSelect(pane.pane_id)}
                selected={pane.pane_id === selectedPaneId}
                label={`Terminal in ${k}${many ? ` ${n}` : ""}`}
              >
                <RowGlyph />
                <span className="min-w-0 overflow-hidden truncate text-[13px] text-text-secondary">{k}</span>
                <RowMeta>{many ? n : null}</RowMeta>
              </Row>
            );
          })}
        </div>
      </div>
    </div>
  );
}

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
      <RowGlyph>
        <StatusIcon status={pane.agent_status} size={14} />
      </RowGlyph>
      <span className="min-w-0 overflow-hidden">
        <span className="block truncate text-[13px] font-medium tracking-[-0.01em] text-text-primary">
          {detail !== name ? detail : name}
        </span>
        <span className="mt-px block truncate text-[11.5px] leading-tight text-text-muted">
          {pane.agent}
          {space ? ` · ${space}` : ""}
        </span>
      </span>
      <RowMeta>{age}</RowMeta>
    </Row>
  );
}

function AgentGroup({
  title,
  panes,
  selectedPaneId,
  now,
}: {
  title: string;
  panes: PaneInfo[];
  selectedPaneId: string | null;
  now: number;
}) {
  const reduce = useReducedMotion();
  return (
    <>
      <GroupLabel>{title}</GroupLabel>
      <div className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {panes.map((pane) => (
            <motion.div
              key={pane.pane_id}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={reduce ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            >
              <AgentRow pane={pane} selected={pane.pane_id === selectedPaneId} now={now} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
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
  const [searchFocus, setSearchFocus] = useState(false);
  const [spacesOpen, setSpacesOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchActive = searchFocus || filter.trim() !== "";

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

  const agentGroupBy = useMustr((s) => s.agentGroupBy);
  const agentOrder = useMustr((s) => s.agentOrder);
  const agentShow = useMustr((s) => s.agentShow);
  const agentStatuses = useMustr((s) => s.agentStatuses);
  const agentNames = useMustr((s) => s.agentNames);
  const resetAgentView = useMustr((s) => s.resetAgentView);

  const allAgents = useMemo(() => scoped.filter((p) => p.agent), [scoped]);
  const visibleAgents = useMemo(() => {
    const statuses = agentStatuses;
    const names = agentNames;
    return sortAgents(
      allAgents.filter((p) => {
        const status = normStatus(p.agent_status);
        if (!passesShow(status, agentShow)) return false;
        if (statuses && !statuses.includes(status)) return false;
        if (names && (!p.agent || !names.includes(p.agent))) return false;
        return true;
      }),
      agentOrder,
    );
  }, [allAgents, agentShow, agentStatuses, agentNames, agentOrder]);

  const agentsBySpace = useMemo(() => {
    const groups = new Map<string, PaneInfo[]>();
    for (const p of visibleAgents) {
      const list = groups.get(p.workspace_id) ?? [];
      list.push(p);
      groups.set(p.workspace_id, list);
    }
    return groups;
  }, [visibleAgents]);

  const viewDirty = agentViewDirty({
    agentGroupBy,
    agentOrder,
    agentShow,
    agentStatuses,
    agentNames,
  });

  // Terminals for one space, nested under its row when scoped.
  const nestedTerminals = (workspaceId: string): PaneInfo[] =>
    scopeId === workspaceId ? scoped.filter((p) => !p.agent) : [];

  const selectPane = useMustr((s) => s.selectPane);
  const git = useMustr((s) => s.git);
  const refresh = useMustr((s) => s.refresh);

  // Local visual order for drag-reorder; resynced when not dragging.
  const [spaceOrder, setSpaceOrder] = useState<string[]>([]);
  const draggingSpace = useRef(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const serverSpaceIds = workspaces.map((w) => w.workspace_id).join(",");
  useEffect(() => {
    if (!draggingSpace.current) setSpaceOrder(serverSpaceIds ? serverSpaceIds.split(",") : []);
  }, [serverSpaceIds]);
  const orderedSpaces = spaceOrder
    .map((id) => workspaces.find((w) => w.workspace_id === id))
    .filter(Boolean) as typeof workspaces;
  const newSpace = useMustr((s) => s.newSpace);
  const reduce = useReducedMotion();

  // The native open panel only sees this Mac's filesystem; on an SSH host
  // the folder is picked with the remote browser instead.
  const servers = useMustr((s) => s.servers);
  const activeServerId = useMustr((s) => s.activeServerId);
  const activeServer = servers.find((s) => s.id === activeServerId) ?? null;
  const [remoteBrowseOpen, setRemoteBrowseOpen] = useState(false);

  const pickFolderForSpace = async () => {
    if (activeServer?.kind === "ssh") {
      setRemoteBrowseOpen(true);
      return;
    }
    const dir = await openDialog({ directory: true, multiple: false, title: "New space folder" });
    if (typeof dir === "string" && dir) await newSpace(dir);
  };

  const knownSpaceIds = new Set(orderedSpaces.map((ws) => ws.workspace_id));
  const visibleSpaces = [
    ...orderedSpaces.map((ws) => ({ id: ws.workspace_id, label: ws.label })),
    ...[...agentsBySpace.keys()]
      .filter((id) => !knownSpaceIds.has(id))
      .map((id) => ({
        id,
        label: workspaces.find((w) => w.workspace_id === id)?.label ?? "Space",
      })),
  ].filter((ws) => (agentsBySpace.get(ws.id) ?? []).length > 0);

  const funnel = (
    <AgentFilterMenu
      trigger={
        <HeaderButton label="Filter agents" active={viewDirty}>
          <FunnelSimple size={14} weight={viewDirty ? "fill" : "light"} aria-hidden />
        </HeaderButton>
      }
    />
  );

  return (
    <div className="flex h-full flex-col">
      <div {...dragHandlers()} className="h-10 shrink-0" />

      <div className="flex flex-col gap-0.5 px-3.5">
        <Row onClick={() => void newTerminal()} label="New terminal" press>
          <RowGlyph>
            <Plus size={16} weight="light" />
          </RowGlyph>
          <span className="text-[13px] text-text-primary">New terminal</span>
        </Row>
        {/* One persistent element that morphs row → field: the glyph never
            moves, only the inset surface and placeholder ink fade. No swap,
            no remount, no crossfade. */}
        <label
          data-open={searchActive ? "" : undefined}
          className={`grid h-8 ${COLS} items-center rounded-lg transition-[background-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover data-[open]:bg-active data-[open]:hover:bg-active focus-within:shadow-[inset_0_0_0_1px_var(--border-strong)]`}
        >
          <RowGlyph>
            <MagnifyingGlass size={16} weight="light" />
          </RowGlyph>
          <input
            ref={searchRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setSearchFocus(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFilter("");
                e.currentTarget.blur();
              }
            }}
            placeholder={searchActive ? "Agent or folder name" : "Search"}
            aria-label="Search panes"
            style={{ outline: "none", boxShadow: "none", WebkitAppearance: "none" }}
            className={`min-w-0 appearance-none border-0 bg-transparent text-[13px] text-text-primary transition-[color] duration-[var(--dur-fast)] ease-[var(--ease-out)] placeholder:transition-[color] placeholder:duration-[var(--dur-fast)] ${
              searchActive ? "placeholder:text-text-muted" : "placeholder:text-text-primary"
            }`}
          />
        </label>
      </div>

      <nav aria-label="Spaces and agents" className="mt-2 min-h-0 flex-1 overflow-y-auto px-3.5 pb-3">
        <SectionHeader
          open={spacesOpen}
          onToggle={() => setSpacesOpen((v) => !v)}
          actions={
            <Tip label="New space from folder">
              <HeaderButton onClick={() => void pickFolderForSpace()} label="New space from folder">
                <FolderPlus size={14} weight="light" aria-hidden />
              </HeaderButton>
            </Tip>
          }
        >
          Spaces
        </SectionHeader>
        <Fold open={spacesOpen}>
        <div className="flex flex-col gap-0.5">
        <Row
          onClick={() => setScope(null)}
          selected={scopeId === null}
          label={`All spaces, ${workspaces.length}`}
        >
          <RowGlyph>
            <Folders size={16} weight="light" />
          </RowGlyph>
          <span className="min-w-0 overflow-hidden truncate text-[13px] text-text-primary">All spaces</span>
          <RowMeta>{workspaces.length}</RowMeta>
        </Row>
        <Reorder.Group axis="y" values={spaceOrder} onReorder={setSpaceOrder} as="div" className="flex flex-col gap-0.5">
        {orderedSpaces.map((ws) => {
          const terminals = nestedTerminals(ws.workspace_id);
          const nestOpen = scopeId === ws.workspace_id;
          const nestedSelected = terminals.some((p) => p.pane_id === selectedPaneId);
          return (
            <Reorder.Item
              key={ws.workspace_id}
              value={ws.workspace_id}
              as="div"
              // Reorder.Item defaults layout to true and types omit `false`.
              // Size springs fight the CSS clip-reveal; layout stays off
              // except while dragging, when siblings must make room.
              layout={spaceDragging && !reduce ? true : (false as unknown as true)}
              transition={spaceDragging && !reduce ? springSettle : { duration: 0 }}
              whileDrag={{ scale: 1.02, zIndex: 10 }}
              onDragStart={() => {
                draggingSpace.current = true;
                setSpaceDragging(true);
              }}
              onDragEnd={() => {
                draggingSpace.current = false;
                setSpaceDragging(false);
                const target = spaceOrder.indexOf(ws.workspace_id);
                if (target >= 0) void moveWorkspace(ws.workspace_id, target).then(refresh);
              }}
            >
              <SpaceMenu workspace={ws}>
              {(() => {
                const cwd = panes.find((p) => p.workspace_id === ws.workspace_id)?.cwd;
                const info = cwd ? git[cwd] : undefined;
                const tall = Boolean(info);
                return (
                  <Row
                    onClick={() => setScope(nestOpen ? null : ws.workspace_id)}
                    selected={nestOpen && !nestedSelected}
                    aria-expanded={nestOpen}
                    label={`Space ${ws.label}, ${ws.pane_count} panes${info ? `, on ${info.branch}` : ""}`}
                    tall={tall}
                  >
                    <RowGlyph>
                      <Folder size={16} weight="light" />
                    </RowGlyph>
                    <span className="min-w-0 overflow-hidden">
                      <span className="block truncate text-[13px] text-text-primary">{ws.label}</span>
                      {info && (
                        <span className="mt-px flex min-w-0 items-baseline font-mono text-[11px] leading-tight text-text-muted">
                          <span className="min-w-0 truncate">{info.branch}</span>
                          {info.dirty && <span className="shrink-0">*</span>}
                        </span>
                      )}
                    </span>
                    <RowMeta center>
                      {/* Count lives in the aria-label; the visual slot hints
                          expand/collapse instead, revealed on hover/focus. */}
                      <span className="flex opacity-0 transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)] group-hover:opacity-100 group-focus-visible:opacity-100">
                        <CaretDown
                          size={10}
                          weight="bold"
                          className="fold-caret"
                          data-open={nestOpen ? "" : undefined}
                          aria-hidden
                        />
                      </span>
                    </RowMeta>
                  </Row>
                );
              })()}
              </SpaceMenu>
              <NestedTerminals
                open={nestOpen}
                terminals={terminals}
                selectedPaneId={selectedPaneId}
                onSelect={selectPane}
              />
            </Reorder.Item>
          );
        })}
        </Reorder.Group>
        </div>
        </Fold>

        {allAgents.length > 0 && (
          <div className="mt-4">
            <SectionHeader
              open={agentsOpen}
              onToggle={() => setAgentsOpen((v) => !v)}
              actions={funnel}
            >
              Agents
            </SectionHeader>
            <Fold open={agentsOpen}>
              {visibleAgents.length === 0 ? (
                <div className="px-2.5 pt-2">
                  <p className="text-[12px] leading-snug text-pretty text-text-secondary">
                    No agents match these filters.
                  </p>
                  <button
                    type="button"
                    onClick={resetAgentView}
                    className="mt-1.5 text-[12px] text-text-primary underline decoration-[rgb(255_255_255/0.2)] underline-offset-2 transition-[color] duration-[var(--dur-fast)] hover:text-text-secondary"
                  >
                    Reset filters
                  </button>
                </div>
              ) : agentGroupBy === "space" ? (
                visibleSpaces.map((ws, i) => (
                  <div key={ws.id} className={i === 0 ? "" : "mt-3"}>
                    <AgentGroup
                      title={ws.label}
                      panes={agentsBySpace.get(ws.id) ?? []}
                      selectedPaneId={selectedPaneId}
                      now={now}
                    />
                  </div>
                ))
              ) : (
                // Flat list. Attention order keeps status runs contiguous, so
                // a wider gap marks each run; the row's status icon says which.
                <div className="flex flex-col gap-0.5">
                  <AnimatePresence initial={false}>
                    {visibleAgents.map((pane, i) => {
                      const runBreak =
                        agentOrder === "attention" &&
                        i > 0 &&
                        normStatus(pane.agent_status) !== normStatus(visibleAgents[i - 1].agent_status);
                      return (
                        <motion.div
                          key={pane.pane_id}
                          className={runBreak ? "mt-1.5" : undefined}
                          initial={reduce ? false : { opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                          transition={reduce ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                        >
                          <AgentRow pane={pane} selected={pane.pane_id === selectedPaneId} now={now} />
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </Fold>
          </div>
        )}

        {scoped.length === 0 && (
          <div className="px-2.5 pt-4">
            {filter ? (
              <>
                <p className="text-[12px] leading-snug text-pretty text-text-secondary">
                  No results for “{filter}”.
                </p>
                <button
                  type="button"
                  onClick={() => setFilter("")}
                  className="mt-1.5 text-[12px] text-text-primary underline decoration-[rgb(255_255_255/0.2)] underline-offset-2 transition-[color] duration-[var(--dur-fast)] hover:text-text-secondary"
                >
                  Clear search
                </button>
              </>
            ) : (
              <p className="text-[12px] leading-snug text-pretty text-text-secondary">
                Nothing running here yet. Create one with New terminal.
              </p>
            )}
          </div>
        )}
      </nav>

      <SessionSwitcher />
      <DevicePill />

      <RemoteFolderDialog
        open={remoteBrowseOpen}
        server={activeServer}
        onOpenChange={setRemoteBrowseOpen}
        onChoose={(path) => void newSpace(path)}
      />
    </div>
  );
}
