// "?" in the toolbar: a quiet reference panel for the app shortcuts wired
// in App.tsx. Built on the dropdown primitive for origin-aware open and the
// shared menu material, but rows are plain text — nothing to activate.
// Shortcuts render macOS-style: label left, glyphs right, no keycap chips.

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Question } from "@phosphor-icons/react";
import { closeAutoFocus } from "../lib/modality";
import { MENU_CONTENT, MENU_SEPARATOR, MENU_SHADOW } from "./ui/menu";

const GROUPS: { title: string; rows: [label: string, keys: string][] }[] = [
  {
    title: "General",
    rows: [
      ["Command palette", "⌘K"],
      ["New terminal", "⌘T"],
      ["Find in terminal", "⌘F"],
      ["Close pane", "⌘W"],
    ],
  },
  {
    title: "Panes",
    rows: [
      ["Split right", "⌘D"],
      ["Split down", "⇧⌘D"],
      ["Zoom pane", "⇧⌘Z"],
    ],
  },
  {
    title: "Tabs",
    rows: [
      ["Go to tab", "⌘1–9"],
      ["Next tab", "⇧⌘}"],
      ["Previous tab", "⇧⌘{"],
    ],
  },
  {
    title: "Text size",
    rows: [
      ["Bigger", "⌘+"],
      ["Smaller", "⌘−"],
      ["Reset", "⌘0"],
    ],
  },
];

export function ShortcutsHelp() {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label="Keyboard shortcuts"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-[color,background-color,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover hover:text-text-primary active:scale-[0.96] data-[state=open]:bg-hover data-[state=open]:text-text-primary"
        >
          <Question size={14} weight="light" aria-hidden />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          onCloseAutoFocus={closeAutoFocus}
          side="bottom"
          align="end"
          sideOffset={6}
          className={`${MENU_CONTENT} min-w-[212px]`}
          style={MENU_SHADOW}
        >
          {GROUPS.map((group, i) => (
            <div key={group.title}>
              {i > 0 && <div className={MENU_SEPARATOR} role="presentation" />}
              <div className="flex h-6 items-center px-2 text-[11px] font-medium text-text-muted">
                {group.title}
              </div>
              {group.rows.map(([label, keys]) => (
                <div
                  key={label}
                  className="flex h-6 cursor-default items-center justify-between gap-4 px-2 text-[13px]"
                >
                  <span className="text-text-primary">{label}</span>
                  <span className="tabular-nums text-text-muted">{keys}</span>
                </div>
              ))}
            </div>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
