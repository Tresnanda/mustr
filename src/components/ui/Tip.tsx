// Tooltip for icon-only controls. Delay on the first open; instant for
// siblings while one is showing (Radix Provider handles the skip window).

import * as Tooltip from "@radix-ui/react-tooltip";
import { MENU_SHADOW } from "./menu";

export function TipProvider({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      {children}
    </Tooltip.Provider>
  );
}

export function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-50 rounded-md bg-sidebar px-2 py-1 text-[11.5px] text-text-primary duration-100 ease-out data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in"
          style={MENU_SHADOW}
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
