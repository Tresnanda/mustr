// App updates over GitHub Releases (Tauri updater). One module-level
// state machine shared by the quiet startup check and the Settings
// control, so both surfaces always agree on what's happening.

import { useSyncExternalStore } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  /** Checked and current — reverts to idle shortly after. */
  | { phase: "none" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; version: string; percent: number | null }
  | { phase: "ready"; version: string }
  | { phase: "error"; message: string };

let state: UpdateState = { phase: "idle" };
let pending: Update | null = null;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  for (const l of listeners) l();
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export async function checkForUpdate(opts: { silent?: boolean } = {}): Promise<void> {
  if (state.phase === "checking" || state.phase === "downloading") return;
  if (!opts.silent) set({ phase: "checking" });
  try {
    const update = await check();
    if (update) {
      pending = update;
      set({ phase: "available", version: update.version });
      if (opts.silent) {
        // Let the toast layer mention it once; Settings carries the action.
        window.dispatchEvent(
          new CustomEvent("mustr:update-available", { detail: { version: update.version } }),
        );
      }
    } else if (!opts.silent) {
      set({ phase: "none" });
      setTimeout(() => {
        if (state.phase === "none") set({ phase: "idle" });
      }, 4000);
    }
  } catch (e) {
    if (!opts.silent) set({ phase: "error", message: String(e) });
  }
}

export async function installUpdate(): Promise<void> {
  if (!pending || state.phase === "downloading") return;
  const version = pending.version;
  let total: number | null = null;
  let received = 0;
  set({ phase: "downloading", version, percent: null });
  try {
    await pending.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        if (total) {
          set({
            phase: "downloading",
            version,
            percent: Math.min(100, Math.round((received / total) * 100)),
          });
        }
      } else if (event.event === "Finished") {
        set({ phase: "ready", version });
      }
    });
    set({ phase: "ready", version });
  } catch (e) {
    set({ phase: "error", message: String(e) });
  }
}

export const restartToUpdate = () => relaunch();

/** Quiet once-per-launch check, main window only, off the launch path. */
export function scheduleStartupCheck() {
  if (new URLSearchParams(window.location.search).get("server")) return;
  setTimeout(() => void checkForUpdate({ silent: true }), 8000);
}
