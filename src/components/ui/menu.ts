// Shared class recipes for Radix menu surfaces — macOS context-menu grammar:
// compact 26px rows, translucent material, tight radii, red for destructive.

export const MENU_CONTENT =
  "z-30 min-w-[184px] rounded-[10px] p-1 backdrop-blur-2xl " +
  "bg-[rgb(42_42_42/0.78)] duration-100 ease-out " +
  "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95";

export const MENU_ITEM =
  "flex h-[26px] w-full cursor-default items-center gap-2 rounded-[6px] px-2 " +
  "text-[13px] outline-none data-[highlighted]:bg-[rgb(255_255_255/0.09)]";

export const MENU_SEPARATOR = "mx-2 my-1 h-px bg-[rgb(255_255_255/0.08)]";

export const MENU_SHADOW = {
  boxShadow:
    "0 0 0 0.5px rgb(255 255 255 / 0.12), 0 0 0 1px rgb(0 0 0 / 0.5), " +
    "0 4px 10px rgb(0 0 0 / 0.3), 0 16px 40px rgb(0 0 0 / 0.4)",
} as const;
