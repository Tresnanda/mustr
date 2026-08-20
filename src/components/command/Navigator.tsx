// ⌘K Navigator — one field over everything on the active server: agents
// (blocked first), spaces, tabs, panes, devices, and actions. Spotlight
// grammar: opens instantly (high-frequency surfaces never animate),
// arrow keys + Enter, Esc closes.

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Desktop,
  Folder,
  Folders,
  HardDrives,
  MagnifyingGlass,
  Plus,
  SquareSplitHorizontal,
} from "@phosphor-icons/react";
import { statusSince, useMustr } from "../../state/store";
import { splitPane } from "../../bridge/herdr";
import { StatusIcon, STATUS_LABEL } from "../status";
import { cwdFolder, paneDetail, paneDisplayName } from "../../lib/names";
import { relativeAge } from "../../lib/time";

interface Item {
  key: string;
  group: "Agents" | "Spaces" | "Tabs" | "Panes" | "Devices" | "Actions";
  icon: React.ReactNode;
  title: string;
  context?: string;
  hint?: string;
  /** Lower ranks list first within relevance ties. */
  rank: number;
  haystack: string;
  run: () => void;
}

const GROUP_ORDER = ["Agents", "Spaces", "Tabs", "Panes", "Devices", "Actions"] as const;
const STATUS_RANK = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 } as const;

export function Navigator({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const store = useMustr();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const close = () => onOpenChange(false);
    const spaceLabel = (workspaceId: string) =>
      store.workspaces.find((w) => w.workspace_id === workspaceId)?.label;

    for (const pane of store.panes) {
      const space = spaceLabel(pane.workspace_id);
      if (pane.agent) {
        out.push({
          key: `agent:${pane.pane_id}`,
          group: "Agents",
          icon: <StatusIcon status={pane.agent_status} size={14} />,
          title: paneDetail(pane),
          context: `${pane.agent}${space ? ` · ${space}` : ""}`,
          hint: `${STATUS_LABEL[pane.agent_status]} · ${relativeAge(statusSince.get(pane.pane_id), store.now) || "now"}`,
          rank: STATUS_RANK[pane.agent_status],
          haystack:
            `${paneDisplayName(pane)} ${paneDetail(pane)} ${pane.agent} ${space ?? ""} ${STATUS_LABEL[pane.agent_status]}`.toLowerCase(),
          run: () => {
            store.selectPane(pane.pane_id);
            close();
          },
        });
      } else {
        out.push({
          key: `pane:${pane.pane_id}`,
          group: "Panes",
          icon: <Folder size={14} className="text-text-secondary" aria-hidden />,
          title: cwdFolder(pane.cwd) ?? pane.pane_id,
          context: space,
          rank: 10,
          haystack: `${cwdFolder(pane.cwd) ?? ""} ${space ?? ""} shell terminal`.toLowerCase(),
          run: () => {
            store.selectPane(pane.pane_id);
            close();
          },
        });
      }
    }

    for (const ws of store.workspaces) {
      out.push({
        key: `space:${ws.workspace_id}`,
        group: "Spaces",
        icon: <Folders size={14} className="text-text-secondary" aria-hidden />,
        title: ws.label,
        hint: `${ws.pane_count} ${ws.pane_count === 1 ? "pane" : "panes"}`,
        rank: 5,
        haystack: `${ws.label} space workspace`.toLowerCase(),
        run: () => {
          store.setScope(ws.workspace_id);
          close();
        },
      });
    }

    for (const tab of store.tabs) {
      const space = spaceLabel(tab.workspace_id);
      out.push({
        key: `tab:${tab.tab_id}`,
        group: "Tabs",
        icon: <SquareSplitHorizontal size={14} className="text-text-secondary" aria-hidden />,
        title: `Tab ${tab.label}`,
        context: space,
        rank: 8,
        haystack: `tab ${tab.label} ${space ?? ""}`.toLowerCase(),
        run: () => {
          store.selectTab(tab.tab_id);
          close();
        },
      });
    }

    for (const server of store.servers) {
      if (server.active) continue;
      out.push({
        key: `device:${server.id}`,
        group: "Devices",
        icon:
          server.kind === "local" ? (
            <Desktop size={14} className="text-text-secondary" aria-hidden />
          ) : (
            <HardDrives size={14} className="text-text-secondary" aria-hidden />
          ),
        title: `Connect to ${server.name}`,
        context: server.detail,
        rank: 12,
        haystack: `connect ${server.name} ${server.detail} device server`.toLowerCase(),
        run: () => {
          void store.switchServer(server.id);
          close();
        },
      });
    }

    out.push({
      key: "action:new-terminal",
      group: "Actions",
      icon: <Plus size={14} className="text-text-secondary" aria-hidden />,
      title: "New terminal",
      rank: 15,
      haystack: "new terminal tab create",
      run: () => {
        void store.newTerminal();
        close();
      },
    });
    if (store.selectedPaneId) {
      const paneId = store.selectedPaneId;
      for (const dir of ["right", "down"] as const) {
        out.push({
          key: `action:split-${dir}`,
          group: "Actions",
          icon: <SquareSplitHorizontal size={14} className="text-text-secondary" aria-hidden />,
          title: dir === "right" ? "Split right" : "Split down",
          rank: 16,
          haystack: `split ${dir} pane`,
          run: () => {
            void splitPane(paneId, dir).then(store.refresh);
            close();
          },
        });
      }
    }
    return out;
  }, [store, onOpenChange]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? items.filter((i) => i.haystack.includes(q))
      : items.filter((i) => i.group !== "Tabs" && i.group !== "Panes");
    return matched.sort((a, b) => {
      if (q) {
        const ap = a.haystack.startsWith(q) ? 0 : 1;
        const bp = b.haystack.startsWith(q) ? 0 : 1;
        if (ap !== bp) return ap - bp;
      }
      const ag = GROUP_ORDER.indexOf(a.group);
      const bg = GROUP_ORDER.indexOf(b.group);
      if (ag !== bg) return ag - bg;
      return a.rank - b.rank;
    });
  }, [items, query]);

  useEffect(() => setActiveIdx(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  let lastGroup: string | null = null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-[18vh] z-50 w-[560px] -translate-x-1/2 overflow-hidden rounded-xl bg-[rgb(44_44_44/0.95)] backdrop-blur-2xl"
          style={{
            boxShadow:
              "0 0 0 0.5px rgb(255 255 255 / 0.1), 0 18px 60px rgb(0 0 0 / 0.5)",
          }}
          aria-label="Navigator"
        >
          <div className="flex h-12 items-center gap-2.5 border-b border-[rgb(255_255_255/0.07)] px-4">
            <MagnifyingGlass size={16} className="shrink-0 text-text-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.min(results.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter" && results[activeIdx]) {
                  results[activeIdx].run();
                }
              }}
              placeholder="Agents, spaces, devices, actions…"
              aria-label="Search everything"
              style={{ outline: "none" }}
              className="h-full w-full bg-transparent text-[15px] text-text-primary placeholder:text-text-muted"
            />
          </div>
          <div ref={listRef} className="max-h-[380px] overflow-y-auto p-1.5">
            {results.length === 0 && (
              <p className="px-3 py-6 text-center text-[13px] text-text-secondary">
                Nothing matches “{query}”.
              </p>
            )}
            {results.map((item, idx) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <div key={item.key}>
                  {header && (
                    <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium text-text-muted first:pt-1">
                      {header}
                    </p>
                  )}
                  <button
                    type="button"
                    data-idx={idx}
                    onClick={item.run}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left ${
                      idx === activeIdx ? "bg-[rgb(255_255_255/0.09)]" : ""
                    }`}
                  >
                    <span className="flex w-4 shrink-0 justify-center">{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                      {item.title}
                      {item.context && (
                        <span className="ml-2 text-[12px] text-text-muted">{item.context}</span>
                      )}
                    </span>
                    {item.hint && (
                      <span className="shrink-0 text-[11.5px] tabular-nums text-text-muted">
                        {item.hint}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
