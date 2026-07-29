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
 */
import { useRef, useState } from "react";
import type * as React from "react";

const DISMISS_THRESHOLD = 80;

export default function useSheetSwipeDown(
  onDismiss: () => void,
  opts?: { enabled?: boolean; scrollRef?: React.RefObject<HTMLElement | null> }
): { handlers: React.DOMAttributes<HTMLElement>; style: React.CSSProperties } {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  const reset = () => {
    setDragY(0);
    startY.current = null;
  };

  const handlers: React.DOMAttributes<HTMLElement> = {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      if (opts?.enabled === false) return;
      const scroller = opts?.scrollRef?.current ?? e.currentTarget;
      if (scroller.scrollTop > 0) return;
      if ((e.target as HTMLElement).closest?.("textarea, input, select")) return;
      startY.current = e.touches[0].clientY;
    },
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
      if (startY.current == null) return;
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
