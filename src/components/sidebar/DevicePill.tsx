// Footer device row → Devices popover: Local plus saved SSH quickies.
// Click a device to connect (tunnel spins up over the user's own ssh);
// Add Device saves a name + destination. Right-click a quickie to remove it.

import { useEffect, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { CaretUpDown, Check, CircleNotch, Desktop, HardDrives, Plus } from "@phosphor-icons/react";
import { useMustr } from "../../state/store";
import { addServer, type ServerRow } from "../../bridge/servers";
import {
  DIALOG_CONTENT,
  DIALOG_OVERLAY,
  MENU_CONTENT,
  MENU_ITEM,
  MENU_ITEM_DANGER,
  MENU_SEPARATOR,
  MENU_SHADOW,
} from "../ui/menu";
import { removeServer } from "../../bridge/servers";

function DeviceRow({ server }: { server: ServerRow }) {
  const { switchServer, connectingId, loadServers } = useMustr();
  const connecting = connectingId === server.id;
  const Icon = server.kind === "local" ? Desktop : HardDrives;

  const row = (
    <Dropdown.Item
      className={`${MENU_ITEM} h-auto py-1.5 text-text-primary data-[disabled]:opacity-60`}
      disabled={connecting}
      onSelect={(e) => {
        e.preventDefault(); // keep the menu open while connecting
        void switchServer(server.id);
      }}
    >
      <Icon size={16} className="shrink-0 text-text-secondary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{server.name}</span>
        <span className="block truncate text-[11.5px] text-text-secondary">{server.detail}</span>
      </span>
      {connecting ? (
        <CircleNotch size={14} className="shrink-0 animate-spin text-text-secondary" aria-label="connecting" />
      ) : server.active ? (
        <Check size={14} weight="bold" className="shrink-0 text-text-primary" aria-label="connected" />
      ) : null}
    </Dropdown.Item>
  );

  if (server.kind === "local") return row;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={MENU_CONTENT} style={MENU_SHADOW}>
          <ContextMenu.Item
            className={MENU_ITEM_DANGER}
            onSelect={() => void removeServer(server.id).then(loadServers)}
          >
            Remove device
          </ContextMenu.Item>
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

  const save = async () => {
    try {
      await addServer(name, host);
      await loadServers();
      onOpenChange(false);
      setName("");
      setHost("");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const FIELD =
    "h-8 w-full rounded-lg border border-border-subtle bg-inset px-2.5 text-[13px] " +
    "text-text-primary transition-colors duration-100 focus:border-border-strong";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content className={DIALOG_CONTENT} style={MENU_SHADOW}>
          <Dialog.Title className="text-[13px] font-semibold text-text-primary">Add device</Dialog.Title>
          <Dialog.Description className="mt-1 text-[13px] leading-snug text-text-secondary">
            Connects over your own SSH setup — keys, agent, and ~/.ssh/config included.
          </Dialog.Description>
          <label className="mt-3 block text-[12px] font-medium text-text-secondary">
            Name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mac Studio"
              style={{ outline: "none" }}
              className={`${FIELD} mt-1`}
            />
          </label>
          <label className="mt-2.5 block text-[12px] font-medium text-text-secondary">
            SSH destination
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder="name@host, or an alias from ~/.ssh/config"
              style={{ outline: "none" }}
              className={`${FIELD} mt-1 font-mono text-[12px]`}
            />
          </label>
          {error && <p className="mt-2 text-[12px] leading-snug text-danger">{error}</p>}
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
              onClick={() => void save()}
              className="rounded-lg bg-selection px-3 py-1.5 text-[13px] font-medium text-text-primary transition-colors duration-100 hover:bg-active active:scale-[0.97]"
            >
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
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const active = servers.find((s) => s.id === activeServerId);

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-100 hover:bg-hover data-[state=open]:bg-hover"
          >
            <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-hover">
              {active?.kind === "ssh" ? (
                <HardDrives size={13} className="text-text-secondary" aria-hidden />
              ) : (
                <Desktop size={13} className="text-text-secondary" aria-hidden />
              )}
              <span
                className={`absolute -bottom-px -right-px size-[7px] rounded-full border-2 border-sidebar ${
                  connected ? "bg-alive" : "bg-status-blocked"
                }`}
                aria-label={connected ? "connected" : "offline"}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-text-primary">
                {active?.name ?? "Local"}
              </span>
              <span className="block truncate text-[11.5px] text-text-secondary">
                {active?.kind === "ssh"
                  ? active.detail
                  : server
                    ? `This Mac · herdr ${server.version}`
                    : "This Mac"}
              </span>
            </span>
            <CaretUpDown size={12} className="shrink-0 text-text-muted" aria-hidden />
          </button>
        </Dropdown.Trigger>

        <Dropdown.Portal>
          <Dropdown.Content
            side="top"
            align="start"
            sideOffset={6}
            className={`${MENU_CONTENT} w-72`}
            style={MENU_SHADOW}
          >
            <Dropdown.Label className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              Devices
            </Dropdown.Label>
            {servers.map((s) => (
              <DeviceRow key={s.id} server={s} />
            ))}
            {connectError && (
              <p className="select-text px-2.5 py-1.5 text-[11.5px] leading-snug text-danger">
                {connectError}
              </p>
            )}
            <Dropdown.Separator className={MENU_SEPARATOR} />
            <Dropdown.Item
              className={`${MENU_ITEM} h-auto py-1.5 text-text-primary`}
              onSelect={() => setAdding(true)}
            >
              <Plus size={16} className="shrink-0 text-text-secondary" aria-hidden />
              <span className="text-[13px]">Add device…</span>
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>

      <AddDeviceDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}
