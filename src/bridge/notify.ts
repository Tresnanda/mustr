// Native OS notifications for agent-state transitions (SPEC §5.1).
// Only two transitions matter: an agent blocking (needs the user) and an
// agent finishing. Everything else would train the user to ignore us.

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { AgentStatus } from "./herdr";

let permitted: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permitted !== null) return permitted;
  permitted = await isPermissionGranted();
  if (!permitted) {
    permitted = (await requestPermission()) === "granted";
  }
  return permitted;
}

export async function notifyStatusChange(
  status: AgentStatus,
  paneName: string,
  agent?: string,
): Promise<void> {
  if (status !== "blocked" && status !== "done") return;
  if (!(await ensurePermission())) return;
  const who = agent ? `${agent} — ${paneName}` : paneName;
  sendNotification(
    status === "blocked"
      ? { title: "Agent needs an answer", body: who }
      : { title: "Agent finished", body: who },
  );
}
