// Footer device row on Radix DropdownMenu — battle-tested focus, dismiss,
// and keyboard handling. Origin-aware scale-in from the trigger corner.
// SSH quickies land here in M2.

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { CaretUpDown, Check, Desktop, Plus } from "@phosphor-icons/react";
import { useMustr } from "../../state/store";

export function DevicePill() {
  const { server, connected } = useMustr();

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-100 hover:bg-hover data-[state=open]:bg-hover"
          >
            <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-hover">
              <Desktop size={13} className="text-text-secondary" aria-hidden />
              <span
                className={`absolute -bottom-px -right-px size-[7px] rounded-full border-2 border-sidebar ${
                  connected ? "bg-alive" : "bg-status-blocked"
                }`}
                aria-label={connected ? "connected" : "offline"}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-text-primary">Local</span>
              <span className="block truncate text-[11.5px] text-text-secondary">
                {server ? `This Mac · herdr ${server.version}` : "This Mac"}
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
            className="z-20 w-64 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-xl bg-sidebar p-1.5 duration-150 ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95"
            style={{ boxShadow: "var(--shadow-popover)" }}
          >
            <Dropdown.Label className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              Devices
            </Dropdown.Label>
            <Dropdown.Item
              className="flex w-full cursor-default items-center gap-2.5 rounded-lg bg-selection px-2.5 py-2 outline-none"
              onSelect={() => {}}
            >
              <Desktop size={16} className="shrink-0 text-text-secondary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary">
                  Local
                  <span
                    className={`size-[5px] rounded-full ${connected ? "bg-alive" : "bg-status-blocked"}`}
                    aria-label={connected ? "connected" : "offline"}
                  />
                </span>
                <span className="block truncate text-[11.5px] text-text-secondary">
                  This Mac · herdr.sock
                </span>
              </span>
              <Check size={14} weight="bold" className="shrink-0 text-text-primary" aria-label="selected" />
            </Dropdown.Item>
            <Dropdown.Separator className="mx-2 my-1 h-px bg-border-subtle" />
            <Dropdown.Item
              disabled
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-text-secondary outline-none data-[disabled]:opacity-70"
              title="SSH remotes arrive in the next milestone"
            >
              <Plus size={16} className="shrink-0" aria-hidden />
              <span className="text-[13px]">Add Device…</span>
              <span className="ml-auto rounded-full bg-hover px-1.5 py-px text-[10px] font-medium text-text-muted">
                Soon
              </span>
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}
