/**
 * useBodyScrollLock — freeze the page behind an open mobile sheet / drawer
 * (odds-and-ends 2026-09-19, item 4: swiping a sheet down was dragging the
 * whole page with it — iOS rubber-bands the document under a fixed overlay
 * unless the body is genuinely un-scrollable).
 *
 * `overflow: hidden` alone is ignored by iOS Safari for touch scrolling, so
 * this uses the position:fixed technique: pin the body at its current scroll
 * offset while locked, restore the offset on release. Reference-counted so
 * overlapping locks (a page with several sheets, a sheet over a sheet) only
 * release when the LAST one closes.
 *
 * Desktop callers pass `false` — dialogs there scroll-lock their own way
 * (ComposeModal / ProfileThoughtsCompose) and are not touched.
 */
import { useEffect } from "react";

let locks = 0;
let savedScrollY = 0;
let saved: { position: string; top: string; left: string; right: string; width: string; overflow: string } | null = null;

function acquire() {
  if (locks++ > 0) return;
  const b = document.body;
  savedScrollY = window.scrollY;
  saved = { position: b.style.position, top: b.style.top, left: b.style.left, right: b.style.right, width: b.style.width, overflow: b.style.overflow };
  b.style.position = "fixed";
  b.style.top = `-${savedScrollY}px`;
  b.style.left = "0";
  b.style.right = "0";
  b.style.width = "100%";
  b.style.overflow = "hidden";
}

function release() {
  if (locks === 0) return;
  if (--locks > 0) return;
  const b = document.body;
  if (saved) {
    b.style.position = saved.position;
    b.style.top = saved.top;
    b.style.left = saved.left;
    b.style.right = saved.right;
    b.style.width = saved.width;
    b.style.overflow = saved.overflow;
    saved = null;
  }
  window.scrollTo(0, savedScrollY);
}

export default function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    acquire();
    return release;
  }, [active]);
}
