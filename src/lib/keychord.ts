// Tiny keyboard-chord model for the configurable remote image-paste bind.
// A chord is a lowercased string like "ctrl+v" or "ctrl+shift+v": zero or
// more modifiers (ctrl/meta/alt/shift, in that canonical order) followed by
// one key. An empty string means "disabled".

const MOD_ORDER = ["ctrl", "meta", "alt", "shift"] as const;

/** Build the canonical chord string for a keydown event, or null if the
    event is a bare modifier press (no primary key yet). */
export function chordFromEvent(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase();
  if (key === "control" || key === "meta" || key === "alt" || key === "shift") return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.metaKey) parts.push("meta");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}

/** Does this keydown event match the configured chord? Empty chord never
    matches (feature disabled). */
export function chordMatches(chord: string, e: KeyboardEvent): boolean {
  if (!chord) return false;
  return chordFromEvent(e) === normalizeChord(chord);
}

/** Reorder modifiers into canonical order so "shift+ctrl+v" == "ctrl+shift+v". */
export function normalizeChord(chord: string): string {
  const parts = chord.toLowerCase().split("+").filter(Boolean);
  const mods = MOD_ORDER.filter((m) => parts.includes(m));
  const keys = parts.filter((p) => !MOD_ORDER.includes(p as (typeof MOD_ORDER)[number]));
  return [...mods, ...keys].join("+");
}

/** Human label for display, e.g. "ctrl+shift+v" → "⌃⇧V". */
export function chordLabel(chord: string): string {
  if (!chord) return "Off";
  const glyph: Record<string, string> = { ctrl: "⌃", meta: "⌘", alt: "⌥", shift: "⇧" };
  return normalizeChord(chord)
    .split("+")
    .map((p) => glyph[p] ?? (p === "space" ? "Space" : p.length === 1 ? p.toUpperCase() : p))
    .join("");
}
