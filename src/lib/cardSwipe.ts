import type React from "react";

/**
 * The deck cards' drag-to-swipe (the question cards and the "You're in"
 * card, both looks). His note, 10-27: a touch becomes a swipe only once the
 * finger has moved SWIPE_CLAIM_PX sideways and further sideways than up or
 * down — until then the page scrolls as usual (the card's touch-action is
 * pan-y), so a tall welcome page can be dragged up from the card itself.
 * A claimed drag that passes SWIPE_COMMIT_PX on release commits.
 */
export const SWIPE_COMMIT_PX = 80;
export const SWIPE_CLAIM_PX = 12;

export function cardSwipeHandlers({ dragStart, claimed, dragX, setDragX, blocked, onCommit }: {
  dragStart: React.MutableRefObject<{ x: number; y: number } | null>;
  claimed: React.MutableRefObject<boolean>;
  dragX: number;
  setDragX: (x: number) => void;
  /** Nothing to drag right now (mid-exit, busy). */
  blocked: () => boolean;
  onCommit: (dir: "left" | "right") => void;
}) {
  return {
    onTouchStart: (e: React.TouchEvent) => {
      if (blocked()) return;
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      claimed.current = false;
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (!dragStart.current || blocked()) return;
      const dx = e.touches[0].clientX - dragStart.current.x;
      const dy = e.touches[0].clientY - dragStart.current.y;
      if (!claimed.current) {
        if (Math.abs(dx) < SWIPE_CLAIM_PX) return;
        // Up or down first: the page's scroll, not a swipe.
        if (Math.abs(dy) > Math.abs(dx)) { dragStart.current = null; return; }
        claimed.current = true;
      }
      setDragX(dx);
    },
    onTouchEnd: () => {
      if (!dragStart.current) return;
      const was = claimed.current;
      dragStart.current = null;
      claimed.current = false;
      if (was && Math.abs(dragX) > SWIPE_COMMIT_PX && !blocked()) onCommit(dragX > 0 ? "right" : "left");
      else setDragX(0);
    },
    onTouchCancel: () => { dragStart.current = null; claimed.current = false; setDragX(0); },
  };
}
