/**
 * lazyWithReload — React.lazy that self-heals the STALE-DEPLOY chunk
 * failure (Sentry, 2026-08-12/13): a tab loaded before a deploy navigates,
 * asks for a page chunk whose hashed filename no longer exists, the dynamic
 * import rejects, and the user got the ErrorBoundary screen — when a plain
 * reload was the actual fix.
 *
 * Now: on import failure, reload the page ONCE. The failure fires during
 * navigation, so the reload lands on the intended URL with the fresh
 * deploy's files. Guards (worst case = today's error screen, never worse):
 *   • once per chunk per tab (sessionStorage flag, cleared on a later
 *     successful load) — a reload that doesn't cure it falls through to
 *     the ErrorBoundary instead of looping;
 *   • no reload while the browser reports itself offline (a dead
 *     connection would swap our error screen for the browser's);
 *   • storage unavailable → treated as already-tried (no loop risk).
 */
import { lazy, type ComponentType } from "react";
import { isStandalone } from "./installPrompt";

export default function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  chunkName: string,
) {
  const key = `ns_chunk_reload_${chunkName}`;
  return lazy(() =>
    factory().then(
      (mod) => {
        try { sessionStorage.removeItem(key); } catch { /* tolerate */ }
        return mod;
      },
      (err) => {
        let alreadyTried = true;
        try {
          alreadyTried = !!sessionStorage.getItem(key);
          if (!alreadyTried) sessionStorage.setItem(key, "1");
        } catch { /* storage unavailable → don't risk a loop */ }
        if (!alreadyTried && (typeof navigator === "undefined" || navigator.onLine !== false)) {
          // Installed (standalone) app: re-enter the same URL as a fresh
          // navigation rather than a reload — iOS can drop the notch inset
          // after an in-app reload (2026-08-18; lib/standaloneInset is the
          // backstop if it happens anyway). Browsers: plain reload.
          if (isStandalone()) window.location.replace(window.location.href);
          else window.location.reload();
          // Stay pending while the reload takes over — no error-boundary flash.
          return new Promise<never>(() => {});
        }
        throw err;
      },
    ),
  );
}
