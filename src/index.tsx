import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import App from "./App";
import BetaGate from "./components/BetaGate";
import ErrorBoundary from "./components/ErrorBoundary";
import { ComposeModalProvider } from "./components/v2/ComposeModal";
import { startHeaderClickAudit } from "./lib/devHeaderAudit";
import { initSentry } from "./lib/sentry";
// Home-screen app (2026-08-18): parks Chrome/Edge's early install prompt for
// the mobile dashboard's "add Sidebar to your home screen" button.
import "./lib/installPrompt";
import { applyStandaloneInsetFallback } from "./lib/standaloneInset";

initSentry();
applyStandaloneInsetFallback();
startHeaderClickAudit();

declare global {
  interface Window { __reactRoot?: ReturnType<typeof createRoot> }
}

if (!window.__reactRoot) {
  window.__reactRoot = createRoot(document.getElementById("root")!);
}

window.__reactRoot.render(
  <ErrorBoundary>
    <BetaGate>
      <BrowserRouter>
        <AuthProvider>
          <ComposeModalProvider>
            <App />
          </ComposeModalProvider>
        </AuthProvider>
      </BrowserRouter>
    </BetaGate>
  </ErrorBoundary>
);
