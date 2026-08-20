// Shared class recipes for Radix menu surfaces so every menu in the app
// speaks one visual language.

export const MENU_CONTENT =
  "z-30 min-w-44 rounded-xl bg-sidebar p-1.5 duration-150 ease-out " +
  "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95";

export const MENU_ITEM =
  "flex w-full cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 " +
  "text-[13px] outline-none data-[highlighted]:bg-hover";

export const MENU_SEPARATOR = "mx-2 my-1 h-px bg-border-subtle";

export const MENU_SHADOW = { boxShadow: "var(--shadow-popover)" } as const;
