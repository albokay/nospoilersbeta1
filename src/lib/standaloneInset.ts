/**
 * standaloneInset — notch-inset fallback for the installed (home-screen) app
 * (2026-08-18, Alborz's "the app gets pushed up after a deploy" report).
 *
 * iOS bug: in a standalone web app, after an in-page reload (which our
 * stale-deploy self-heal in lazyWithReload triggers right after deploys),
 * Safari can report `env(safe-area-inset-top)` as 0 until the app is
 * force-quit and relaunched — so every mobile page's top bar slides up under
 * the clock/notch. This probes the real value at boot and, when it reads 0
 * on an iOS device that plainly has a status bar, applies the standard inset
 * as body padding via a class theme.ts styles (`body.pwa-inset-fallback`).
 *
 * Conditions are strict — standalone AND iOS AND the probe reads 0 — so in
 * normal operation (notched phones always report > 0 in standalone; even an
 * SE reports 20) this never fires. Not a substitute for the pages' own
 * env() padding, which keeps working whenever iOS reports it.
 */
import { isStandalone } from "./installPrompt";

export function applyStandaloneInsetFallback(): void {
  try {
    if (typeof window === "undefined" || !isStandalone()) return;
    const ua = navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!isIOS) return;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    const measured = probe.getBoundingClientRect().height;
    probe.remove();
    if (measured > 0) return; // iOS reported the inset — nothing to do
    // Status-bar heights by device class (portrait screen height in points):
    // Dynamic-Island phones ≈ 59, notch phones ≈ 47, home-button phones 20.
    const sh = Math.max(window.screen.height, window.screen.width);
    const inset = sh >= 852 && sh !== 896 && sh !== 926 ? 59 : sh >= 812 ? 47 : 20;
    document.documentElement.style.setProperty("--pwa-inset-top", `${inset}px`);
    document.body.classList.add("pwa-inset-fallback");
  } catch { /* never let a layout nicety break boot */ }
}
