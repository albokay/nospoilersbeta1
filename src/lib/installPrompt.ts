/**
 * installPrompt — home-screen app plumbing (2026-08-18).
 *
 * Chrome/Edge (Android + desktop) fire `beforeinstallprompt` EARLY in the
 * page's life when the site is installable; the event has to be caught and
 * parked so a button that mounts later (the mobile dashboard's "add Sidebar
 * to your home screen") can trigger the real install dialog. Import this
 * module from the entry (src/index.tsx) so the listener is up before React
 * renders anything.
 *
 * iOS never fires it — Safari has no install API; the button shows the
 * share-icon guide there instead (see MobileAddToHomeScreen).
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button; Chrome's mini-infobar stays quiet
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** True when the browser has handed us a native install prompt to fire. */
export function canPromptInstall(): boolean {
  return deferred != null;
}

/** Fire the native install dialog. Resolves true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const ev = deferred;
  if (!ev) return false;
  deferred = null; // a prompt event is single-use
  listeners.forEach((l) => l());
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    return outcome === "accepted";
  } catch {
    return false;
  }
}

/** Subscribe to prompt availability changes (returns unsubscribe). */
export function onInstallPromptChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Already running as the installed app (standalone window / home-screen). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return !!nav.standalone || (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
}

export type InstallPath =
  | "prompt"       // native install dialog available (Chrome/Edge)
  | "ios-safari"   // iPhone/iPad in Safari → share-icon guide
  | "ios-chrome"   // iPhone/iPad in Chrome/Firefox/Edge → their share menu (top right)
  | "ios-webview"  // iPhone inside another app's browser → "open in Safari first"
  | "generic";     // everything else → generic browser-menu guide

/** Which install experience this browser gets. */
export function installPath(): InstallPath {
  if (canPromptInstall()) return "prompt";
  if (typeof navigator === "undefined") return "generic";
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports as a Mac; the touch-points check catches it.
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIOS) return "generic";
  if (/CriOS|FxiOS|EdgiOS/.test(ua)) return "ios-chrome";
  // WKWebView user agents (Gmail, Instagram, Messages previews…) omit the
  // "Safari" token that real Safari carries.
  if (!/Safari/.test(ua)) return "ios-webview";
  return "ios-safari";
}
