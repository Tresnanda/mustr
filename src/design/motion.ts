/** Shared motion tokens — keep numeric values in sync with tokens.css. */

export const easeOut = [0.23, 1, 0.32, 1] as const;
export const easeInOut = [0.77, 0, 0.175, 1] as const;

export const durFast = 0.12;
export const durBase = 0.2;
export const durSlow = 0.3;

export const springDefault = { type: "spring" as const, duration: 0.4, bounce: 0 };
export const springPop = { type: "spring" as const, duration: 0.3, bounce: 0.15 };
export const springSettle = { type: "spring" as const, duration: 0.3, bounce: 0 };

export const tweenFast = { duration: durFast, ease: easeOut };
export const tweenBase = { duration: durBase, ease: easeOut };
export const tweenExit = { duration: 0.15, ease: easeOut };
