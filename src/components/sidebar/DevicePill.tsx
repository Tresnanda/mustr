// Footer device row → Devices popover: Local plus saved SSH quickies.
// Click a device to connect (tunnel spins up over the user's own ssh);
// Add Device saves a name + destination. Right-click a quickie to remove it.

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { CaretUpDown, Check, CircleNotch, Desktop, GearSix, HardDrives, Plus } from "@phosphor-icons/react";
import { closeAutoFocus } from "../../lib/modality";
import { useMustr } from "../../state/store";
import { addServer, openHostWindow, sshAliases, type ServerRow } from "../../bridge/servers";
import {
  BTN,
  BTN_PRIMARY,
  DIALOG_CONTENT,
  DIALOG_OVERLAY,
  DIALOG_SHADOW,
  FIELD,
  MATERIAL_POP,
  MENU_CONTENT,
  MENU_ITEM,
  MENU_ITEM_DANGER,
  MENU_SEPARATOR,
  MENU_SHADOW,
} from "../ui/menu";
import { removeServer } from "../../bridge/servers";
import { SettingsDialog } from "../settings/SettingsDialog";
import { Tip } from "../ui/Tip";
import { springPop } from "../../design/motion";

function DeviceRow({ server }: { server: ServerRow }) {
  const { switchServer, connectingId, loadServers, activeServerId } = useMustr();
  const connecting = connectingId === server.id;
  const active = server.id === activeServerId;
  const Icon = server.kind === "local" ? Desktop : HardDrives;
  const reduce = useReducedMotion();
  const swap = reduce
    ? { duration: 0 }
    : { type: "spring" as const, duration: 0.3, bounce: 0 };
  const enter = reduce ? false : { scale: 0.3, opacity: 0, filter: "blur(3px)" };
  const leave = reduce ? { opacity: 0 } : { scale: 0.3, opacity: 0, filter: "blur(3px)" };

  const row = (
    <Dropdown.Item
      className={`flex h-auto w-full cursor-default items-center gap-3 rounded-[7px] px-2.5 py-2 text-text-primary outline-none data-[disabled]:opacity-60 data-[highlighted]:bg-[rgb(255_255_255/0.07)] ${
        active ? "bg-[rgb(255_255_255/0.05)]" : ""
      }`}
      disabled={connecting}
      onSelect={(e) => {
        e.preventDefault(); // keep the menu open while connecting
        void switchServer(server.id);
      }}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-[rgb(255_255_255/0.06)]">
        <Icon size={15} className="text-text-secondary" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-tight">{server.name}</span>
        <span className="mt-px block truncate text-[11.5px] leading-tight text-text-secondary">
          {server.detail}
        </span>
      </span>
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {connecting ? (
            <motion.span
              key="spin"
              initial={enter}
              animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
              exit={leave}
              transition={swap}
              className="inline-flex"
            >
              <CircleNotch size={14} className="animate-spin text-text-secondary" aria-label="connecting" />
            </motion.span>
          ) : active ? (
            <motion.span
              key="check"
              initial={enter}
              animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
              exit={leave}
              transition={swap}
              className="inline-flex"
            >
              <Check size={14} weight="bold" className="text-text-primary" aria-label="connected" />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
    </Dropdown.Item>
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={MENU_CONTENT} style={MENU_SHADOW}>
          <ContextMenu.Item
            className={MENU_ITEM}
            onSelect={() => void openHostWindow(server.id).then(loadServers)}
          >
            Open in new window
          </ContextMenu.Item>
          {server.kind === "ssh" && (
            <>
              <ContextMenu.Separator className={MENU_SEPARATOR} />
              <ContextMenu.Item
                className={MENU_ITEM_DANGER}
                onSelect={() => void removeServer(server.id).then(loadServers)}
              >
                Remove device
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function AddDeviceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const loadServers = useMustr((s) => s.loadServers);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aliases, setAliases] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    if (open) void sshAliases().then(setAliases).catch(() => setAliases([]));
  }, [open]);

  const matches = aliases.filter(
    (a) => !host.trim() || a.toLowerCase().includes(host.trim().toLowerCase()),
  );

  const pick = (alias: string) => {
    setHost(alias);
    if (!name.trim()) setName(alias);
    setSuggesting(false);
    setActiveIdx(-1);
  };

  const save = async () => {
    try {
      await addServer(name, host);
      await loadServers();
      onOpenChange(false);
      setName("");
      setHost("");
      setError(null);
    } catch {
      setError("Unable to add this device. Check the destination and try again.");
    }
  };

  const FIELD_CLASS = `${FIELD} mt-1.5`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content className={DIALOG_CONTENT} style={DIALOG_SHADOW}>
          <Dialog.Title className="text-[13px] font-semibold text-balance text-text-primary">Add device</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-[13px] leading-snug text-pretty text-text-secondary">
            Connects over your own SSH setup — keys, agent, and config included.
          </Dialog.Description>

          <div className="mt-4 space-y-3.5">
            <label className="block text-[12px] font-medium text-text-secondary">
              Name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mac Studio"
                style={{ outline: "none" }}
                className={FIELD_CLASS}
              />
            </label>
            <label className="relative block text-[12px] font-medium text-text-secondary">
              SSH destination
              <input
                value={host}
                role="combobox"
                aria-expanded={suggesting && matches.length > 0}
                aria-controls="ssh-alias-listbox"
                aria-autocomplete="list"
                onChange={(e) => {
                  setHost(e.target.value);
                  setSuggesting(true);
                  setActiveIdx(-1);
                }}
                onFocus={() => setSuggesting(true)}
                onBlur={() => setTimeout(() => setSuggesting(false), 120)}
                onKeyDown={(e) => {
                  const open = suggesting && matches.length > 0;
                  if (e.key === "ArrowDown" && open) {
                    e.preventDefault();
                    setActiveIdx((i) => (i + 1) % matches.length);
                  } else if (e.key === "ArrowUp" && open) {
                    e.preventDefault();
                    setActiveIdx((i) => (i <= 0 ? matches.length - 1 : i - 1));
                  } else if (e.key === "Enter") {
                    if (open && activeIdx >= 0) pick(matches[activeIdx]);
                    else void save();
                  } else if (e.key === "Escape" && open) {
                    e.stopPropagation();
                    setSuggesting(false);
                  }
                }}
                placeholder="name@host or config alias"
                style={{ outline: "none" }}
                className={`${FIELD_CLASS} font-mono text-[12px]`}
              />
              {suggesting && matches.length > 0 && (
                <ul
                  id="ssh-alias-listbox"
                  role="listbox"
                  aria-label="Hosts from your SSH config"
                  className={`absolute inset-x-0 top-full z-10 mt-1 max-h-[148px] overflow-y-auto rounded-[11px] p-[5px] ${MATERIAL_POP}`}
                  style={MENU_SHADOW}
                >
                  {matches.map((alias, i) => (
                    <li key={alias} role="option" aria-selected={i === activeIdx}>
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => {
                          e.preventDefault(); // beat the input blur
                          pick(alias);
                        }}
                        onMouseEnter={() => setActiveIdx(i)}
                        className={`flex h-6 w-full items-center rounded-[6px] px-2 text-left font-mono text-[12px] ${
                          i === activeIdx ? "bg-[rgb(255_255_255/0.1)] text-text-primary" : "text-text-secondary"
                        }`}
                      >
                        {alias}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </label>
            {error && <p className="text-[12px] leading-snug text-danger">{error}</p>}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className={BTN}>
                Cancel
              </button>
            </Dialog.Close>
            <button type="button" onClick={() => void save()} className={BTN_PRIMARY}>
              Add device
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DevicePill() {
  const { server, connected, servers, activeServerId, connectError, loadServers } = useMustr();
  const reduce = useReducedMotion();
  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const active = servers.find((s) => s.id === activeServerId);

  return (
    <div className="flex shrink-0 items-center gap-1 px-3.5 pt-1.5 pb-3">
      <div className="min-w-0 flex-1">
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-[background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover data-[state=open]:bg-hover"
          >
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-hover">
              {active?.kind === "ssh" ? (
                <HardDrives size={14} weight="light" className="text-text-secondary" aria-hidden />
              ) : (
                <Desktop size={14} weight="light" className="text-text-secondary" aria-hidden />
              )}
              <AnimatePresence initial={false}>
                <motion.span
                  key={connected ? "on" : "off"}
                  initial={reduce ? false : { scale: 0.5 }}
                  animate={{ scale: 1 }}
                  transition={reduce ? { duration: 0 } : springPop}
                  className={`absolute -right-px -bottom-px size-[7px] rounded-full border-2 border-sidebar ${
                    connected ? "bg-alive" : "bg-status-blocked"
                  }`}
                  aria-label={connected ? "connected" : "offline"}
                />
              </AnimatePresence>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium tracking-[-0.01em] text-text-primary">
                {active?.name ?? "Local"}
              </span>
              <span className="mt-px block truncate text-[11.5px] leading-tight text-text-muted">
                {active?.kind === "ssh"
                  ? active.detail
                  : server
                    ? `This Mac · herdr ${server.version}`
                    : "This Mac"}
              </span>
            </span>
            <CaretUpDown size={12} weight="light" className="shrink-0 text-text-muted" aria-hidden />
          </button>
        </Dropdown.Trigger>

        <Dropdown.Portal>
          <Dropdown.Content
            onCloseAutoFocus={closeAutoFocus}
            side="top"
            align="start"
            sideOffset={6}
            className={`${MENU_CONTENT} w-72`}
            style={MENU_SHADOW}
          >
            <Dropdown.Label className="px-2.5 pt-1.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.02em] text-text-muted uppercase">
              Devices
            </Dropdown.Label>
            {servers.map((s) => (
              <DeviceRow key={s.id} server={s} />
            ))}
            {connectError && (
              <p className="select-text px-2.5 py-1.5 text-[11.5px] leading-snug text-pretty text-danger">
                Unable to connect. Check the destination and try again.
              </p>
            )}
            <Dropdown.Separator className={MENU_SEPARATOR} />
            <Dropdown.Item
              className="flex h-auto w-full cursor-default items-center gap-3 rounded-[7px] px-2.5 py-2 text-text-primary outline-none data-[highlighted]:bg-[rgb(255_255_255/0.07)]"
              onSelect={() => setAdding(true)}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-[rgb(255_255_255/0.06)]">
                <Plus size={15} className="text-text-secondary" aria-hidden />
              </span>
              <span className="text-[13px] font-medium">Add device…</span>
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>

      </div>
      <Tip label="Settings (⌘,)">
        <button
          type="button"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-[color,background-color,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover hover:text-text-primary active:scale-[0.97]"
        >
          <GearSix size={16} weight="light" aria-hidden />
        </button>
      </Tip>

      <AddDeviceDialog open={adding} onOpenChange={setAdding} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
