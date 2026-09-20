/**
 * useVersionRefresh — the installed app (and any long-lived tab) picks up a
 * new deploy WITHOUT a force-quit (odds-and-ends 2026-09-19, item 3).
 *
 * There is no service worker (just a manifest), so nothing manages updates:
 * iOS keeps the old page alive in standalone mode until the app is killed,
 * and a desktop tab left open keeps its bundle forever. This closes that gap.
 *
 * DETECT — the loaded main bundle is index.html's one
 *   <script type="module" src="/assets/index-HASH.js">. Fetching /index.html
 *   afresh (no-store) and reading ITS module src says whether a newer build
 *   is deployed. Checked when the app regains visibility (coming back to it)
 *   and on each navigation, throttled to once a minute.
 *
 * APPLY — ONLY at a navigation (Alborz: never mid-composition or anything
 *   the user is in the middle of; a route change is by definition between
 *   things). The next route change becomes a full navigation to the SAME
 *   target, so the new code loads at the destination and nothing the user
 *   was doing is interrupted. window.location.replace(target) throughout —
 *   the 2026-08-18 standalone rule (an in-app reload can drop the iOS notch
 *   inset; a fresh navigation doesn't). Sibling of lazyWithReload, which is
 *   the REACTIVE half (a chunk that 404s after a deploy).
 *
 * LOOP GUARD — the fetched src we reloaded for is remembered in
 *   sessionStorage; if the CDN is still handing out the older index.html, we
 *   never reload for that same value twice, so a stale edge can't bounce the
 *   app between builds. Offline / fetch failures are silently skipped.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

const CHECK_MIN_INTERVAL_MS = 60_000;
const RELOADED_FOR_KEY = "ns_version_reloaded_for";

function loadedBundleSrc(): string | null {
  const s = document.querySelector('script[type="module"][src*="/assets/index-"]') as HTMLScriptElement | null;
  if (!s) return null;
  try { return new URL(s.src, window.location.href).pathname; } catch { return null; }
}

function bundleSrcIn(html: string): string | null {
  const m = html.match(/<script[^>]*type="module"[^>]*src="([^"]*\/assets\/index-[^"]+)"/);
  return m ? m[1] : null;
}

export default function useVersionRefresh(): void {
  const location = useLocation();
  const loaded = useRef<string | null>(null);
  const pending = useRef<string | null>(null);
  const lastCheck = useRef(0);
  const mounted = useRef(false);

  const check = async (force = false) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (!loaded.current) return;
    const now = Date.now();
    if (!force && now - lastCheck.current < CHECK_MIN_INTERVAL_MS) return;
    lastCheck.current = now;
    try {
      const res = await fetch(`/index.html?nsv=${now}`, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return;
      const fresh = bundleSrcIn(await res.text());
      if (!fresh || fresh === loaded.current) { pending.current = null; return; }
      let already: string | null = null;
      try { already = sessionStorage.getItem(RELOADED_FOR_KEY); } catch { /* tolerate */ }
      if (already === fresh) return; // stale edge — don't bounce
      pending.current = fresh;
    } catch { /* offline or blocked — try again later */ }
  };

  // Learn our own bundle once; re-check whenever the app comes back into view.
  useEffect(() => {
    loaded.current = loadedBundleSrc();
    const onVisible = () => { if (document.visibilityState === "visible") void check(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every navigation: apply a pending update (full navigation to the same
  // target), else run a throttled check. The mount render isn't a navigation.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (pending.current) {
      try { sessionStorage.setItem(RELOADED_FOR_KEY, pending.current); } catch { /* tolerate */ }
      window.location.replace(location.pathname + location.search + location.hash);
      return;
    }
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
}
