import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import App from "./App";
import BetaGate from "./components/BetaGate";
import { ComposeModalProvider } from "./components/v2/ComposeModal";
import { startHeaderClickAudit } from "./lib/devHeaderAudit";

startHeaderClickAudit();

declare global {
  interface Window { __reactRoot?: ReturnType<typeof createRoot> }
}

if (!window.__reactRoot) {
  window.__reactRoot = createRoot(document.getElementById("root")!);
}

window.__reactRoot.render(
  <BetaGate>
    <BrowserRouter>
      <AuthProvider>
        <ComposeModalProvider>
          <App />
        </ComposeModalProvider>
      </AuthProvider>
    </BrowserRouter>
  </BetaGate>
);
