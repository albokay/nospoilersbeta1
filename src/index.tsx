import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

declare global {
  interface Window { __reactRoot?: ReturnType<typeof createRoot> }
}

if (!window.__reactRoot) {
  window.__reactRoot = createRoot(document.getElementById("root")!);
}

window.__reactRoot.render(<App />);
