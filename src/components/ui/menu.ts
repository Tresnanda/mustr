// Radix menu recipes — strict macOS context-menu grammar: text-only items,
// 24px rows, translucent material, one soft shadow, red fill on destructive
// highlight. No icons: native menus carry meaning in words.

/* ---- Floating materials: one family, weight encodes hierarchy ----
   pop: transient anchored surfaces (menus, tooltips, comboboxes).
   panel: floating chrome over live content (toasts, find bar, palette) —
   heavier so terminal text stays legible underneath.
   Dialogs are heavier still (DIALOG_CONTENT): content must never bleed. */
export const MATERIAL_POP = "backdrop-blur-2xl backdrop-saturate-150 bg-[rgb(45_45_45/0.72)]";
export const MATERIAL_PANEL = "backdrop-blur-2xl backdrop-saturate-150 bg-[rgb(44_44_44/0.85)]";

export const MENU_CONTENT =
  `m-pop z-[var(--z-dropdown)] min-w-[168px] rounded-[11px] p-[5px] ${MATERIAL_POP}`;

export const MENU_ITEM =
  "flex h-6 w-full cursor-default items-center rounded-[6px] px-2 text-[13px] " +
  "outline-none data-[highlighted]:bg-[rgb(255_255_255/0.11)]";

/** Radio / checkbox rows: left gutter for the check, same 24px height. */
export const MENU_ITEM_CHECK =
  "relative flex h-6 w-full cursor-default items-center rounded-[6px] py-0 pr-2 pl-6 text-[13px] " +
  "outline-none data-[highlighted]:bg-[rgb(255_255_255/0.11)]";

export const MENU_CHECK =
  "absolute left-1.5 flex size-3.5 items-center justify-center text-text-primary";

/** Submenu row: label, current value, caret. Open state matches highlight. */
export const MENU_SUB =
  "flex h-6 w-full cursor-default items-center justify-between gap-3 rounded-[6px] px-2 text-[13px] " +
  "outline-none data-[highlighted]:bg-[rgb(255_255_255/0.11)] data-[state=open]:bg-[rgb(255_255_255/0.11)]";

export const MENU_ITEM_DANGER =
  "flex h-6 w-full cursor-default items-center rounded-[6px] px-2 text-[13px] " +
  "text-danger outline-none data-[highlighted]:bg-danger data-[highlighted]:text-white";

export const MENU_SEPARATOR = "mx-[9px] my-[5px] h-px bg-[rgb(255_255_255/0.07)]";

/* One shadow recipe for every floating surface: top light-catch, hairline
   ring, soft drop. Dialogs and the palette are the biggest surfaces, so
   they read thicker via a deeper (still soft) drop — never a darker one. */
export const MENU_SHADOW = {
  boxShadow:
    "inset 0 0.5px 0 rgb(255 255 255 / 0.14), 0 0 0 0.5px rgb(255 255 255 / 0.09), 0 8px 24px rgb(0 0 0 / 0.28)",
} as const;

export const DIALOG_SHADOW = {
  boxShadow:
    "inset 0 0.5px 0 rgb(255 255 255 / 0.14), 0 0 0 0.5px rgb(255 255 255 / 0.09), 0 16px 44px rgb(0 0 0 / 0.32)",
} as const;

/* ---- Dialogs: near-opaque material — content must never bleed through ---- */

export const DIALOG_OVERLAY = "m-overlay fixed inset-0 z-[var(--z-modal)] bg-black/45";

export const DIALOG_CONTENT =
  "m-dialog fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[340px] -translate-x-1/2 -translate-y-1/2 " +
  "rounded-xl bg-[rgb(44_44_44/0.93)] p-5 backdrop-blur-2xl backdrop-saturate-150";

export const FIELD =
  "h-8 w-full rounded-lg border border-border-subtle bg-inset px-2.5 text-[13px] " +
  "text-text-primary transition-[border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "focus:border-border-strong";

export const BTN =
  "rounded-lg px-3 py-1.5 text-[13px] text-text-primary " +
  "transition-[color,background-color,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "hover:bg-hover active:scale-[0.96]";

export const BTN_PRIMARY = `${BTN} bg-selection font-medium hover:bg-active`;

/* Own classes — do not extend BTN, whose hover:bg-hover would wash the fill. */
export const BTN_DANGER =
  "rounded-lg px-3 py-1.5 text-[13px] font-medium text-white bg-danger " +
  "transition-[color,background-color,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "hover:bg-danger-hover active:scale-[0.96]";
