// One xterm.js instance attached to one herdr pane over TerminalAnsi.
// Server owns scrollback: wheel is forwarded as AttachScroll, or as VT SGR
// mouse sequences when the child app has enabled mouse tracking. The wheel
// listener runs in the capture phase so xterm's own viewport (scrollback: 0)
// can't swallow it.

import { useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const attachId = `${paneId}#${Date.now()}`;
    let disposed = false;
    let mouseCaptured = false;

    const term = new Terminal({
      fontFamily: "SF Mono, ui-monospace, Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      scrollback: 0,
      cursorBlink: true,
      allowProposedApi: true,
      allowTransparency: !REDUCED_TRANSPARENCY,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    if (REDUCED_TRANSPARENCY) {
      // WebGL renders faster but cannot composite transparency; the DOM
      // renderer carries the glass look.
      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // DOM renderer fallback is automatic.
      }
    }
    fit.fit();

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
      if (disposed) return;
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
      detachPane(attachId).catch(() => {});
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

  return (
    <div className="h-full py-3 pl-4 pr-1">
      <div ref={hostRef} className="term-host h-full w-full select-text" />
    </div>
  );
}
