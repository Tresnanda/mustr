// One xterm.js instance attached to one herdr pane over TerminalAnsi.
// Server owns scrollback: wheel is forwarded as AttachScroll, or as VT SGR
// mouse sequences when the child app has enabled mouse tracking. The wheel
// listener runs in the capture phase so xterm's own viewport (scrollback: 0)
// can't swallow it.

import { useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMustr } from "../../state/store";
import {
  attachPane,
  decodeBase64,
  detachPane,
  paneInput,
  paneResize,
  paneScroll,
} from "../../bridge/herdr";

const REDUCED_TRANSPARENCY =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-transparency: reduce)").matches;

const THEME: ITheme = {
  // Fully transparent: the pane sits directly on the window's glass surface.
  background: REDUCED_TRANSPARENCY ? "#1e1e1e" : "rgba(0,0,0,0)",
  foreground: "#d9d9d6",
  cursor: "#c8c8c8",
  cursorAccent: "#1e1e1e",
  selectionBackground: "#3a3a3a",
  black: "#33332f", red: "#e5716c", green: "#7cbf7a", yellow: "#d9b06c",
  blue: "#7aa5e6", magenta: "#bb95e0", cyan: "#72b8bf", white: "#b8b8b4",
  brightBlack: "#5c5c57", brightRed: "#f2938f", brightGreen: "#9fd49d",
  brightYellow: "#e8c78f", brightBlue: "#9dbdf0", brightMagenta: "#d0b3ec",
  brightCyan: "#96cfd4", brightWhite: "#e3e3df",
};

interface Props {
  paneId: string;
  onClosed?: (reason: string | null) => void;
}

export function TerminalView({ paneId, onClosed }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fontSize = useMustr((s) => s.termFontSize);
  const findOpen = useMustr((s) => s.findOpen);
  const setFindOpen = useMustr((s) => s.setFindOpen);
  const isFocusedPane = useMustr((s) => s.selectedPaneId === paneId);
  const [findQuery, setFindQuery] = useState("");

  // Live font size: applies to the running terminal, then refits.
  useEffect(() => {
    const term = termRef.current;
    const host = hostRef.current;
    if (!term || !host) return;
    term.options.fontSize = fontSize;
    if (host.clientWidth > 0 && host.clientHeight > 0) fitRef.current?.fit();
  }, [fontSize]);

  useEffect(() => {
    if (findOpen && isFocusedPane) return;
    searchRef.current?.clearDecorations();
  }, [findOpen, isFocusedPane]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const attachId = `${paneId}#${Date.now()}`;
    let disposed = false;
    let mouseCaptured = false;

    const term = new Terminal({
      fontFamily: "SF Mono, ui-monospace, Menlo, monospace",
      fontSize: useMustr.getState().termFontSize,
      lineHeight: 1.0,
      scrollback: 0,
      cursorBlink: true,
      allowProposedApi: true,
      allowTransparency: !REDUCED_TRANSPARENCY,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const search = new SearchAddon();
    term.loadAddon(search);
    // Links: ⌘-click opens (terminal convention); hover underlines.
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (event.metaKey) void openUrl(uri);
      }),
    );
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;
    term.open(host);
    const fitSafely = () => {
      if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    };
    if (REDUCED_TRANSPARENCY) {
      // WebGL renders faster but cannot composite transparency; the DOM
      // renderer carries the glass look.
      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // DOM renderer fallback is automatic.
      }
    }
    fitSafely();

    term.onData((data) => {
      paneInput(attachId, new TextEncoder().encode(data)).catch(() => {});
    });
    term.onBinary((data) => {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
      paneInput(attachId, bytes).catch(() => {});
    });

    const cellAt = (event: WheelEvent) => {
      const rect = host.getBoundingClientRect();
      const col = Math.min(
        term.cols,
        Math.max(1, Math.ceil(((event.clientX - rect.left) / rect.width) * term.cols)),
      );
      const row = Math.min(
        term.rows,
        Math.max(1, Math.ceil(((event.clientY - rect.top) / rect.height) * term.rows)),
      );
      return { col, row };
    };

    // Mouse-tracking apps (Claude Code's UI, htop, …) expect real clicks.
    // Forward left/middle press, drag, and release as SGR sequences when the
    // app owns the mouse. Shift bypasses forwarding so text selection always
    // works (the same escape hatch real terminals use). Right-click stays
    // ours (context menu).
    let buttonHeld = -1;
    const sgrMouse = (btn: number, event: MouseEvent, release: boolean, motion = false) => {
      const { col, row } = cellAt(event as unknown as WheelEvent);
      const code = btn + (motion ? 32 : 0);
      const seq = `\x1b[<${code};${col};${row}${release ? "m" : "M"}`;
      paneInput(attachId, new TextEncoder().encode(seq)).catch(() => {});
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!mouseCaptured || event.shiftKey || event.button === 2) return;
      buttonHeld = event.button === 1 ? 1 : 0;
      sgrMouse(buttonHeld, event, false);
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!mouseCaptured || buttonHeld < 0) return;
      sgrMouse(buttonHeld, event, false, true);
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!mouseCaptured || buttonHeld < 0) return;
      sgrMouse(buttonHeld, event, true);
      buttonHeld = -1;
    };
    host.addEventListener("mousedown", onMouseDown);
    host.addEventListener("mousemove", onMouseMove);
    host.addEventListener("mouseup", onMouseUp);

    // Capture phase: beat xterm's viewport to the event. Trackpads flood
    // small-delta events, so accumulate and emit one line per LINE_PX of
    // actual travel — never a minimum line per event (that overshoots).
    const LINE_PX = 22;
    let wheelAcc = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      wheelAcc += event.deltaY;
      const steps = Math.trunc(wheelAcc / LINE_PX);
      if (steps === 0) return;
      wheelAcc -= steps * LINE_PX;
      const up = steps < 0;
      const lines = Math.min(3, Math.abs(steps));
      if (mouseCaptured) {
        // Child app owns the mouse: send discrete SGR wheel clicks.
        const { col, row } = cellAt(event);
        const seq = `\x1b[<${up ? 64 : 65};${col};${row}M`.repeat(lines);
        paneInput(attachId, new TextEncoder().encode(seq)).catch(() => {});
      } else {
        paneScroll(attachId, up, lines).catch(() => {});
      }
    };
    host.addEventListener("wheel", onWheel, { passive: false, capture: true });

    const observer = new ResizeObserver(() => {
      if (disposed || host.clientWidth === 0 || host.clientHeight === 0) return;
      fit.fit();
      paneResize(attachId, term.cols, term.rows).catch(() => {});
    });
    observer.observe(host);

    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const attach = () => {
      attachPane(attachId, paneId, term.cols, term.rows, (event) => {
        if (disposed) return;
        switch (event.type) {
          case "data":
            retries = 0;
            term.write(decodeBase64(event.b64));
            break;
          case "mouse_capture":
            mouseCaptured = event.enabled;
            break;
          case "closed":
            // Dropped (server restart, or another client took the terminal
            // over). Reattach quietly; surface an error only when it sticks.
            if (event.reason && retries < 5) {
              retries += 1;
              retryTimer = setTimeout(attach, 800 * retries);
            } else if (event.reason) {
              setError(event.reason);
            }
            onClosed?.(event.reason);
            break;
        }
      }).catch((err) => {
        if (retries < 5) {
          retries += 1;
          retryTimer = setTimeout(attach, 800 * retries);
        } else {
          setError(String(err));
        }
      });
    };
    attach();

    term.focus();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      observer.disconnect();
      host.removeEventListener("wheel", onWheel, { capture: true });
      host.removeEventListener("mousedown", onMouseDown);
      host.removeEventListener("mousemove", onMouseMove);
      host.removeEventListener("mouseup", onMouseUp);
      detachPane(attachId).catch(() => {});
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      term.dispose();
    };
  }, [paneId, onClosed]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="text-[13px] font-semibold text-text-primary">Unable to attach to this pane</p>
          <p className="mt-1 text-[13px] text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  const runFind = (backwards: boolean) => {
    const search = searchRef.current;
    if (!search || !findQuery) return;
    const opts = { decorations: { matchOverviewRuler: "#6f6f6f", activeMatchColorOverviewRuler: "#ececec" } };
    if (backwards) search.findPrevious(findQuery, opts);
    else search.findNext(findQuery, opts);
  };

  return (
    <div className="relative h-full py-3 pl-4 pr-1">
      {findOpen && isFocusedPane && (
        <div
          className="absolute right-3 top-3 z-10 flex h-8 items-center gap-2 rounded-lg bg-[rgb(44_44_44/0.95)] px-2.5 backdrop-blur-xl"
          style={{ boxShadow: "0 0 0 0.5px rgb(255 255 255 / 0.1), 0 6px 20px rgb(0 0 0 / 0.35)" }}
        >
          <input
            autoFocus
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value);
              searchRef.current?.findNext(e.target.value, { incremental: true });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") runFind(e.shiftKey);
              else if (e.key === "Escape") {
                setFindOpen(false);
                termRef.current?.focus();
              }
            }}
            placeholder="Find in terminal"
            aria-label="Find in terminal"
            style={{ outline: "none" }}
            className="w-44 bg-transparent text-[12.5px] text-text-primary placeholder:text-text-muted"
          />
        </div>
      )}
      <div ref={hostRef} className="term-host h-full w-full select-text" />
    </div>
  );
}
