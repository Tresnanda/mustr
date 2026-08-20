// Reliable window-drag surface. The declarative data-tauri-drag-region
// attribute proved flaky through nested children, so this calls
// startDragging() explicitly. Double-click toggles maximize, matching the
// native titlebar contract.

import { getCurrentWindow } from "@tauri-apps/api/window";

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, input, a, [role='menu']") !== null;
}

export function dragHandlers() {
  return {
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button !== 0 || e.detail !== 1 || isInteractive(e.target)) return;
      void getCurrentWindow().startDragging();
    },
    onDoubleClick: (e: React.MouseEvent) => {
      if (isInteractive(e.target)) return;
      void getCurrentWindow().toggleMaximize();
    },
  };
}
