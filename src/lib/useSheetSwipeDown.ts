/**
 * useSheetSwipeDown — follow-the-finger swipe-down dismiss for mobile bottom
 * sheets. Built for the tips sheet first (help-system CP4); rolled out to the
 * app's other bottom sheets 2026-07-28 (the deliberately-deferred follow-up).
 *
 * Attach {...swipe.handlers} to the sheet element and merge swipe.style into
 * its style. Rules baked in:
 * • the drag only engages moving DOWN, and only while the sheet's scrollable
 *   content sits at the top (native scrolling wins otherwise) — pass
 *   `scrollRef` when the scrollable element is an inner child, not the sheet
 *   element itself;
 * • release past 80px dismisses; under it the sheet springs back;
 * • drags starting inside a text field never move the sheet (typing,
 *   caret drags and textarea scrolling stay untouched);
 * • touchcancel springs back.
 *
 * Callers with a busy-guard (e.g. a save in flight) pass `enabled: false`
 * while busy — the sheet then doesn't move at all.
 *
 * 2026-09-19 (odds-and-ends item 4 — "swiping a sheet dragged the whole
 * page, felt loose"): two fixes, one cause. React's touch listeners are
 * PASSIVE, so nothing here ever stopped the browser from scrolling /
 * rubber-banding the page underneath the moving sheet. Now (1) while the
 * sheet is `open` the page behind it is frozen (useBodyScrollLock), and
 * (2) a real non-passive touchmove listener decides on the FIRST move —
 * down = this is a sheet drag, preventDefault for the rest of the gesture;
 * up = native scrolling owns the gesture, hands off. Deciding on the first
 * move matters: iOS commits a gesture to scrolling on its first un-prevented
 * touchmove and ignores later preventDefaults.
 *
 * `open` defaults to true (a sheet that mounts only while open). A component
 * that stays mounted with the sheet closed (page-level hooks, the tips tab)
 * MUST pass its open state, or the page stays frozen.
 */
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import useBodyScrollLock from "./useBodyScrollLock";

const DISMISS_THRESHOLD = 80;
const DIRECTION_SLOP = 2;

export default function useSheetSwipeDown(
  onDismiss: () => void,
  opts?: { enabled?: boolean; scrollRef?: React.RefObject<HTMLElement | null>; open?: boolean }
): { handlers: React.DOMAttributes<HTMLElement>; style: React.CSSProperties } {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  // Decided once per gesture by the native listener: true = downward sheet
  // drag (native scroll blocked); a decided-upward gesture nulls startY so
  // every handler below early-returns for the rest of it.
  const engaged = useRef(false);
  const detach = useRef<(() => void) | null>(null);

  useBodyScrollLock(opts?.open ?? true);

  const reset = () => {
    setDragY(0);
    startY.current = null;
    engaged.current = false;
    detach.current?.();
    detach.current = null;
  };

  // Never leave a native listener behind if the sheet unmounts mid-gesture.
  useEffect(() => () => { detach.current?.(); }, []);

  const handlers: React.DOMAttributes<HTMLElement> = {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      if (opts?.enabled === false) return;
      const scroller = opts?.scrollRef?.current ?? e.currentTarget;
      if (scroller.scrollTop > 0) return;
      if ((e.target as HTMLElement).closest?.("textarea, input, select")) return;
      startY.current = e.touches[0].clientY;
      engaged.current = false;
      const el = e.currentTarget;
      const block = (ev: TouchEvent) => {
        if (startY.current == null) return;
        if (!engaged.current) {
          const d = ev.touches[0].clientY - startY.current;
          if (d < -DIRECTION_SLOP) { startY.current = null; return; } // up → native scroll
          if (d < DIRECTION_SLOP) return;                              // undecided yet
          engaged.current = true;
        }
        if (ev.cancelable) ev.preventDefault();
      };
      el.addEventListener("touchmove", block, { passive: false });
      detach.current?.();
      detach.current = () => el.removeEventListener("touchmove", block);
    },
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
      if (startY.current == null || !engaged.current) return;
      const d = e.touches[0].clientY - startY.current;
      setDragY(d > 0 ? d : 0);
    },
    onTouchEnd: () => {
      const shouldDismiss = startY.current != null && dragY > DISMISS_THRESHOLD;
      reset();
      if (shouldDismiss) onDismiss();
    },
    onTouchCancel: reset,
  };

  return {
    handlers,
    style: {
      transform: `translateY(${dragY}px)`,
      transition: startY.current == null ? "transform .18s ease" : "none",
    },
  };
}
