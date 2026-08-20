// Radix menu recipes — strict macOS context-menu grammar: text-only items,
// 24px rows, translucent material, one soft shadow, red fill on destructive
// highlight. No icons: native menus carry meaning in words.

export const MENU_CONTENT =
  "z-30 min-w-[168px] rounded-[11px] p-[5px] backdrop-blur-2xl " +
  "bg-[rgb(45_45_45/0.72)] duration-100 ease-out " +
  "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95";

export const MENU_ITEM =
  "flex h-6 w-full cursor-default items-center rounded-[5px] px-2 text-[13px] " +
  "outline-none data-[highlighted]:bg-[rgb(255_255_255/0.11)]";

export const MENU_ITEM_DANGER =
  "flex h-6 w-full cursor-default items-center rounded-[5px] px-2 text-[13px] " +
  "text-danger outline-none data-[highlighted]:bg-danger data-[highlighted]:text-white";

export const MENU_SEPARATOR = "mx-[9px] my-[5px] h-px bg-[rgb(255_255_255/0.07)]";

export const MENU_SHADOW = {
  boxShadow: "0 0 0 0.5px rgb(255 255 255 / 0.09), 0 10px 34px rgb(0 0 0 / 0.38)",
} as const;
