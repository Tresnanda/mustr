// Tracks whether the user is currently driving with pointer or keyboard,
// so menus can skip their close-refocus for pointer sessions (programmatic
// refocus matches :focus-visible and paints an unwanted keyboard ring).

let lastInput: "pointer" | "keyboard" = "pointer";

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => (lastInput = "pointer"), true);
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Tab" || e.key.startsWith("Arrow") || e.key === "Enter" || e.key === " ") {
        lastInput = "keyboard";
      }
    },
    true,
  );
}

/** For Radix onCloseAutoFocus: keep focus return only for keyboard users. */
export function closeAutoFocus(event: Event) {
  if (lastInput === "pointer") event.preventDefault();
}
