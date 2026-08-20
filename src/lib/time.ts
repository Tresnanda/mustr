/** Compact relative age: "now", "3m", "5h", "2d". */
export function relativeAge(sinceMs: number | undefined, nowMs: number): string {
  if (!sinceMs) return "";
  const s = Math.max(0, Math.floor((nowMs - sinceMs) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
