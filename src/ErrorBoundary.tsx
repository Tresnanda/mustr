// Renders the crash instead of an empty window — a transparent app that
// silently unmounts is undebuggable and looks broken.

import React from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center bg-content p-8">
          <div className="max-w-lg">
            <p className="text-[13px] font-semibold text-balance text-text-primary">Mustr hit an error</p>
            <pre className="mt-2 select-text font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-status-blocked">
              {String(this.state.error.stack ?? this.state.error)}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
