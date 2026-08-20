import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./index.css";

// Native-feel: never show the WebView's own Reload/Inspect menu. Radix menus
// call preventDefault on their triggers before this listener fires.
window.addEventListener("contextmenu", (e) => e.preventDefault());

const appearance = localStorage.getItem("mustr:appearance");
if (appearance) document.documentElement.dataset.appearance = appearance;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
