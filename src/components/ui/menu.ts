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

/* ---- Dialogs: near-opaque material — content must never bleed through ---- */

export const DIALOG_OVERLAY = "fixed inset-0 z-40 bg-black/45";

export const DIALOG_CONTENT =
  "fixed left-1/2 top-1/2 z-50 w-[340px] -translate-x-1/2 -translate-y-1/2 " +
  "rounded-xl bg-[rgb(44_44_44/0.93)] p-5 backdrop-blur-2xl " +
  "duration-150 ease-out data-[state=open]:animate-in data-[state=open]:fade-in " +
  "data-[state=open]:zoom-in-95";
