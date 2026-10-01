import { isStandalone } from "../lib/installPrompt";

// The home-screen app's bottom strip (Alborz 2026-09-30). On the installed
// app iOS lays the page out short of the screen's bottom edge, and the band
// beneath shows the PAGE's background — so an open sheet, a drawer, or the
// chat's composer bar looked like it floated above a strip of page colour.
// That band paints the canvas (the root element's background), so this keeps
// the root's background equal to whatever sits at the bottom edge of the
// layout: the open sheet's colour while one is up, the page's otherwise.
// Standalone only — a browser tab has no such band — and it changes no
// layout: one colour on <html>, re-read when the page changes.

/** "rgb(r, g, b)" when the colour is opaque, else null. */
function opaque(c: string): string | null {
  const m = c.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return c && c !== "transparent" && !c.startsWith("rgba") ? c : null;
  const parts = m[1].split(/[,/]/).map((x) => x.trim()).filter(Boolean);
  const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
  return alpha >= 0.99 ? `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})` : null;
}

/** The first opaque background at the bottom-centre of the layout. */
function sample(): string | null {
  const x = Math.round(window.innerWidth / 2);
  const y = Math.max(0, window.innerHeight - 2);
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el && el !== document.documentElement) {
    const c = opaque(getComputedStyle(el).backgroundColor);
    if (c) return c;
    el = el.parentElement;
  }
  return null;
}

export function startBottomBleed(): () => void {
  if (typeof window === "undefined" || !isStandalone()) return () => {};
  const root = document.documentElement;
  let last = "";
  const timers = new Set<number>();
  const apply = () => {
    try {
      const c = sample();
      if (c && c !== last) { last = c; root.style.backgroundColor = c; }
    } catch { /* tolerate — the strip just keeps its last colour */ }
  };
  // One read soon, then two more once sheet animations have settled.
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    for (const ms of [60, 320, 720]) {
      const t = window.setTimeout(() => { timers.delete(t); if (ms === 720) pending = false; apply(); }, ms);
      timers.add(t);
    }
  };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
  const evs = ["resize", "orientationchange", "pageshow"] as const;
  for (const e of evs) window.addEventListener(e, schedule);
  document.addEventListener("transitionend", schedule, true);
  document.addEventListener("animationend", schedule, true);
  schedule();
  return () => {
    mo.disconnect();
    for (const e of evs) window.removeEventListener(e, schedule);
    document.removeEventListener("transitionend", schedule, true);
    document.removeEventListener("animationend", schedule, true);
    for (const t of timers) window.clearTimeout(t);
    root.style.backgroundColor = "";
  };
}
