// Folder browser for "New space" on an SSH host — the native open panel
// can only see this Mac, so remote spaces pick their folder here. Open-panel
// grammar: list carries selection, Return descends, ⌘↑ goes up, type-select
// jumps, ⇧⌘. toggles hidden folders, the primary button acts on the
// selection (or the current folder when nothing is selected).

import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUp, Eye, EyeSlash, Folder, GitBranch, House } from "@phosphor-icons/react";
import { listRemoteDirs, type RemoteDirListing, type ServerRow } from "../../bridge/servers";
import { BTN, BTN_PRIMARY, DIALOG_OVERLAY, DIALOG_SHADOW, FIELD } from "../ui/menu";
import { Tip } from "../ui/Tip";

const CONTENT =
  "m-dialog fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[460px] -translate-x-1/2 -translate-y-1/2 " +
  "rounded-xl bg-[rgb(44_44_44/0.93)] p-5 backdrop-blur-2xl backdrop-saturate-150";

const TOOL_BTN =
  "flex size-7 shrink-0 items-center justify-center rounded-lg text-text-secondary " +
  "transition-[color,background-color,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "hover:bg-hover hover:text-text-primary active:scale-[0.96] " +
  "outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--focus-ring)]";

function parentOf(path: string): string {
  const cut = path.replace(/\/+$/, "").lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}

function joinPath(path: string, name: string): string {
  return path === "/" ? `/${name}` : `${path}/${name}`;
}

function abbreviate(path: string, home: string): string {
  if (home && path === home) return "~";
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

export function RemoteFolderDialog({
  open,
  server,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  server: ServerRow | null;
  onOpenChange: (open: boolean) => void;
  onChoose: (path: string) => void;
}) {
  const [listing, setListing] = useState<RemoteDirListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sel, setSel] = useState(-1);
  const [pathInput, setPathInput] = useState("");
  /** Drives the list's directional cross-blur; keyed per navigation. */
  const [anim, setAnim] = useState<{ dir: "deeper" | "up" | "none"; key: number }>({
    dir: "none",
    key: 0,
  });
  const [shaking, setShaking] = useState(false);

  const requestSeq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const typeahead = useRef({ buffer: "", at: 0 });

  const lastPathKey = server ? `mustr.remote-folder.${server.id}` : null;

  const navigate = useCallback(
    async (to: string, dir: "deeper" | "up" | "none", selectName?: string) => {
      if (!server) return;
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const result = await listRemoteDirs(server.id, to);
        if (seq !== requestSeq.current) return;
        setListing(result);
        setPathInput(abbreviate(result.path, result.home));
        setAnim((a) => ({ dir, key: a.key + 1 }));
        // Index into the rendered (hidden-filtered) list, not the raw one.
        const visible = result.entries.filter(
          (e) => showHidden || !e.name.startsWith("."),
        );
        setSel(selectName ? visible.findIndex((e) => e.name === selectName) : -1);
        if (lastPathKey) {
          try {
            localStorage.setItem(lastPathKey, result.path);
          } catch {
            /* storage unavailable — remembering the folder is optional */
          }
        }
      } catch (e) {
        if (seq !== requestSeq.current) return;
        if (String(e) === "no-such-dir") {
          if (!listing) {
            // Remembered folder is gone — fall back to home quietly.
            void navigate("", "none");
            return;
          }
          setError(`That folder doesn't exist on ${server.name}.`);
          setPathInput(abbreviate(listing.path, listing.home));
          setShaking(true);
        } else {
          setError(String(e));
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [server, listing, lastPathKey, showHidden],
  );

  // Fresh session per open: start at the last-used folder, else home.
  useEffect(() => {
    if (!open || !server) return;
    setListing(null);
    setError(null);
    setSel(-1);
    setShowHidden(false);
    setAnim({ dir: "none", key: 0 });
    let start = "";
    if (lastPathKey) {
      try {
        start = localStorage.getItem(lastPathKey) ?? "";
      } catch {
        /* storage unavailable */
      }
    }
    void navigate(start, "none");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, server?.id]);

  const entries = (listing?.entries ?? []).filter(
    (e) => showHidden || !e.name.startsWith("."),
  );
  const atRoot = listing?.path === "/";
  const targetPath =
    listing === null
      ? null
      : sel >= 0 && entries[sel]
        ? joinPath(listing.path, entries[sel].name)
        : listing.path;

  const goUp = () => {
    if (!listing || atRoot || loading) return;
    const from = listing.path.split("/").filter(Boolean).pop();
    void navigate(parentOf(listing.path), "up", from);
  };
  const descend = (index: number) => {
    if (!listing || !entries[index] || loading) return;
    void navigate(joinPath(listing.path, entries[index].name), "deeper");
  };
  const commit = () => {
    if (!targetPath) return;
    onChoose(targetPath);
    onOpenChange(false);
  };

  const focusOption = (index: number) => {
    setSel(index);
    optionRefs.current[index]?.focus();
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusOption(Math.min(sel + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      if (e.metaKey) {
        e.preventDefault();
        goUp();
      } else {
        e.preventDefault();
        focusOption(Math.max(sel - 1, 0));
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      if (entries.length) focusOption(0);
    } else if (e.key === "End") {
      e.preventDefault();
      if (entries.length) focusOption(entries.length - 1);
    } else if (e.key === "Enter" && !e.metaKey) {
      e.preventDefault();
      if (sel >= 0) descend(sel);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Type-select, Finder-style: prefix match with a decaying buffer.
      const now = Date.now();
      const t = typeahead.current;
      t.buffer = (now - t.at > 700 ? "" : t.buffer) + e.key.toLowerCase();
      t.at = now;
      const hit = entries.findIndex((en) => en.name.toLowerCase().startsWith(t.buffer));
      if (hit >= 0) focusOption(hit);
    }
  };

  const onDialogKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      commit();
    } else if (e.key === "." && e.metaKey && e.shiftKey) {
      e.preventDefault();
      setSel(-1);
      setShowHidden((v) => !v);
    } else if (e.key === "ArrowUp" && e.metaKey) {
      e.preventDefault();
      goUp();
    }
  };

  const displayTarget =
    listing && targetPath ? abbreviate(targetPath, listing.home) : "";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content
          className={CONTENT}
          style={DIALOG_SHADOW}
          onKeyDown={onDialogKeyDown}
          aria-describedby={undefined}
        >
          <Dialog.Title className="text-[13px] font-semibold text-balance text-text-primary">
            New space on {server?.name ?? "this device"}
          </Dialog.Title>

          {/* Path bar: editable path, enclosing folder, home, hidden toggle. */}
          <div className="mt-3 flex items-center gap-1.5">
            <input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.metaKey) {
                  e.preventDefault();
                  void navigate(pathInput.trim(), "none");
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (entries.length) focusOption(Math.max(sel, 0));
                }
              }}
              aria-label={`Folder path on ${server?.name ?? "the device"}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "rfb-error" : undefined}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onAnimationEnd={() => setShaking(false)}
              style={{ outline: "none" }}
              className={`${FIELD} font-mono ${shaking ? "rfb-shake" : ""}`}
            />
            <Tip label="Enclosing folder">
              <button
                type="button"
                onClick={goUp}
                disabled={!listing || atRoot || loading}
                aria-label="Enclosing folder"
                className={`${TOOL_BTN} disabled:pointer-events-none disabled:opacity-40`}
              >
                <ArrowUp size={14} weight="light" aria-hidden />
              </button>
            </Tip>
            <Tip label="Home folder">
              <button
                type="button"
                onClick={() => void navigate("", "up")}
                disabled={loading || (listing !== null && listing.path === listing.home)}
                aria-label="Home folder"
                className={`${TOOL_BTN} disabled:pointer-events-none disabled:opacity-40`}
              >
                <House size={14} weight="light" aria-hidden />
              </button>
            </Tip>
            <Tip label={showHidden ? "Hide hidden folders" : "Show hidden folders"}>
              <button
                type="button"
                onClick={() => {
                  setSel(-1);
                  setShowHidden((v) => !v);
                }}
                aria-label={showHidden ? "Hide hidden folders" : "Show hidden folders"}
                aria-pressed={showHidden}
                className={`${TOOL_BTN} ${showHidden ? "bg-active text-text-primary" : ""}`}
              >
                {showHidden ? (
                  <Eye size={14} weight="light" aria-hidden />
                ) : (
                  <EyeSlash size={14} weight="light" aria-hidden />
                )}
              </button>
            </Tip>
          </div>

          {error && (
            <p id="rfb-error" role="alert" className="mt-2 text-[12px] leading-snug text-pretty text-danger-soft">
              {error}
            </p>
          )}

          {/* Folder list. Keyed per navigation so the directional cross-blur
              replays; dimmed (not cleared) while the next listing loads. */}
          <div
            className={`mt-2 h-[264px] overflow-y-auto rounded-lg border border-border-subtle bg-inset transition-[opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] ${loading && listing ? "opacity-55" : ""}`}
            aria-busy={loading || undefined}
          >
            {listing === null ? (
              <div className="flex h-full items-center justify-center">
                <span className="rfb-shimmer text-[13px]" role="status">
                  {error ? "" : `Connecting to ${server?.name ?? "device"}…`}
                </span>
              </div>
            ) : entries.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
                <span className="text-[13px] text-text-secondary">No subfolders</span>
                <span className="text-[12px] leading-snug text-pretty text-text-muted">
                  Create the space here, or go up to browse elsewhere.
                </span>
              </div>
            ) : (
              <div
                key={anim.key}
                ref={listRef}
                role="listbox"
                aria-label={`Folders in ${abbreviate(listing.path, listing.home)}`}
                onKeyDown={onListKeyDown}
                className={`flex flex-col gap-px p-1 ${
                  anim.dir === "deeper" ? "rfb-in-deeper" : anim.dir === "up" ? "rfb-in-up" : ""
                }`}
              >
                {entries.map((entry, i) => (
                  <div
                    key={entry.name}
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    role="option"
                    aria-selected={sel === i}
                    tabIndex={i === Math.max(sel, 0) ? 0 : -1}
                    onClick={() => setSel(i)}
                    onDoubleClick={() => descend(i)}
                    onFocus={() => setSel(i)}
                    className={`flex h-7 cursor-default items-center gap-2 rounded-[6px] px-2 outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--focus-ring)] ${
                      sel === i ? "bg-selection" : "hover:bg-hover"
                    }`}
                  >
                    <Folder size={16} weight="light" className="shrink-0 text-text-secondary" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                      {entry.name}
                    </span>
                    {entry.git && (
                      <GitBranch
                        size={12}
                        weight="light"
                        className="shrink-0 text-text-muted"
                        aria-label="Git repository"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted" aria-live="polite">
              {displayTarget && `In ${displayTarget}`}
            </span>
            <Dialog.Close asChild>
              <button type="button" className={BTN}>
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={commit}
              disabled={!targetPath || loading}
              className={`${BTN_PRIMARY} disabled:pointer-events-none disabled:opacity-40`}
            >
              Create space
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
