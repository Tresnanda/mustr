// One xterm.js instance attached to one herdr pane over TerminalAnsi.
// Server owns scrollback: wheel is forwarded as AttachScroll, or as VT SGR
// mouse sequences when the child app has enabled mouse tracking. The wheel
// listener runs in the capture phase so xterm's own viewport (scrollback: 0)
// can't swallow it.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { openUrl } from "@tauri-apps/plugin-opener";
import { X } from "@phosphor-icons/react";
import { MATERIAL_PANEL, MENU_SHADOW } from "../ui/menu";
import { useMustr } from "../../state/store";
import {
  attachPane,
  decodeBase64,
  detachPane,
  paneInput,
  paneResize,
  paneScroll,
} from "../../bridge/herdr";
import { tweenBase, tweenExit } from "../../design/motion";

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
  /** Bumped when the server connection returns after this pane gave up,
      remounting the attachment; a live attachment never remounts. */
  const [epoch, setEpoch] = useState(0);
  const connected = useMustr((s) => s.connected);
  const fontSize = useMustr((s) => s.termFontSize);
  const findOpen = useMustr((s) => s.findOpen);
  const setFindOpen = useMustr((s) => s.setFindOpen);
  const isFocusedPane = useMustr((s) => s.selectedPaneId === paneId);
  const [findQuery, setFindQuery] = useState("");
  const reduce = useReducedMotion();
  /** Mirror of the server's MouseCapture signal, for the cursor. */
  const [capturedUi, setCapturedUi] = useState(false);
  // The server can't tell attach clients about pane mouse state (see
  // protocol-notes), so the cursor falls back to what Mustr does know:
  // agent panes are interactive UIs — arrow; plain shells are text — I-beam.
  const isAgentPane = useMustr((s) =>
    Boolean(s.panes.find((p) => p.pane_id === paneId)?.agent),
  );

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

  // Tunnel restored (e.g. after sleep or a network drop): retry an
  // attachment that exhausted its backoff instead of staying dead.
  useEffect(() => {
    if (connected && error) {
      setError(null);
      setEpoch((e) => e + 1);
    }
  }, [connected, error]);

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

    // Attach-client mouse, per live-server probing (see protocol-notes):
    // the server never sends MouseCapture to attach clients, strips the
    // pane's mode-enable sequences from frames, has no attach-mouse wire
    // message, and unconditionally types Input bytes into the pty (garbage
    // at a shell prompt). So clicks stay off until the server can say the
    // pane wants them — the SGR path below is gated on that future signal.
    // Wheel already works: AttachScroll is routed server-side.
    let buttonHeld = -1;
    const cellAt = (event: MouseEvent) => {
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
    const sgrMouse = (btn: number, event: MouseEvent, release: boolean, motion = false) => {
      const { col, row } = cellAt(event);
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
      // AttachScroll always: the server routes it into the pane as mouse
      // reports when the child app tracks the mouse, host scrollback when
      // it doesn't — knowledge only the server has.
      paneScroll(attachId, up, lines).catch(() => {});
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
            // The server owns the pane's dimensions: when a sibling closes,
            // herdr resizes this pane itself and streams frames at the new
            // size — adopt it before writing, or the bytes land in a grid
            // shaped for the old split and the screen garbles.
            if (
              event.cols > 0 &&
              event.rows > 0 &&
              (term.cols !== event.cols || term.rows !== event.rows)
            ) {
              term.resize(event.cols, event.rows);
            }
            // A full repaint replaces the whole viewport; drop stale cells
            // first so regions the frame doesn't touch can't linger.
            if (event.full) term.write("\x1b[2J\x1b[H");
            term.write(decodeBase64(event.b64));
            break;
          case "mouse_capture":
            mouseCaptured = event.enabled;
            setCapturedUi(event.enabled);
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
  }, [paneId, onClosed, epoch]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="text-[13px] font-semibold text-balance text-text-primary">Unable to attach to this pane</p>
          <p className="mt-1 text-[13px] leading-snug text-pretty text-text-secondary">{error}</p>
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
    <div className="relative h-full py-4 ps-5 pe-2">
      <AnimatePresence>
        {findOpen && isFocusedPane && (
          <motion.div
            key="find"
            initial={reduce ? false : { opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97, transition: tweenExit }}
            transition={reduce ? { duration: 0 } : tweenBase}
            className={`absolute top-3 right-3 z-10 flex h-8 origin-top-right items-center gap-1.5 rounded-lg px-2 ${MATERIAL_PANEL}`}
            style={MENU_SHADOW}
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
            <button
              type="button"
              aria-label="Close find"
              onClick={() => {
                setFindOpen(false);
                termRef.current?.focus();
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-[color,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-text-primary active:scale-[0.97]"
            >
              <X size={12} aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <div
        ref={hostRef}
        className={`term-host h-full w-full select-text ${
          capturedUi || isAgentPane ? "term-mouse-owned" : ""
        }`}
      />
    </div>
  );
}
