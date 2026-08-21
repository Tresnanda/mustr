// Tooltip for icon-only controls. Delay on the first open; instant for
// siblings while one is showing (Radix Provider handles the skip window).

import type { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { MATERIAL_POP, MENU_SHADOW } from "./menu";

export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      {children}
    </Tooltip.Provider>
  );
}

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className={`m-tip z-[var(--z-tooltip)] rounded-md px-2 py-1 text-[11.5px] text-text-primary ${MATERIAL_POP}`}
          style={MENU_SHADOW}
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
