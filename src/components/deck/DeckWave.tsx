/**
 * DeckWave — serves ONE fixed onboarding wave of swipe-deck cards
 * (swipe-deck arc CP2; spec §12). Shared by both platforms via `idiom`.
 *
 * Self-contained and self-skipping: fetches the released deck + the caller's
 * answers on mount, queues this wave's UNANSWERED cards, and if there's
 * nothing to serve (already answered / pre-seed / prior wave still owed with
 * `requirePriorWave`) calls onComplete without rendering anything — so
 * callers mount it unconditionally in a sequence and it costs two tolerant
 * reads. Nothing renders until the queue is known → no flash.
 *
 * Answering: agree/disagree only, no skip, no dismissal (spec §2). Each
 * answer persists immediately (best-effort — a failed write is warned, not
 * blocking; the drip catch-up re-serves any card that didn't stick).
 * Mobile ALSO supports drag-to-swipe (2026-07-26 — the flagged
 * nice-to-have): the card follows the finger with a slight tilt, flies
 * out past the commit threshold (right = YES, left = NOPE), springs back
 * otherwise. Desktop stays tap-only.
 *
 * Tabs break the card's edges per the mockups: desktop NOPE/YES at
 * mid-height left/right; mobile diagonal (NOPE top-left, YES bottom-right).
 * The page dims behind the card everywhere (Alborz, CP0 review).
 */
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { fetchDeckCards, fetchMyDeckAnswers, upsertDeckAnswer, type DeckCard } from "../../lib/db";
import { readPendingDeckAnswers, addPendingDeckAnswer } from "../../lib/deckPending";
import { CANON } from "../../styles/canon";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export default function DeckWave({ wave, heading, idiom, requirePriorWave, leadCardId, anonymous, onComplete }: {
  /** 1 | 2 = the fixed onboarding waves. "drip" (CP4) = the catch-up/drip
   *  modal: up to 4 unanswered cards released SINCE THIS ACCOUNT SIGNED UP,
   *  oldest first, at most once per session (sessionStorage flag). Cards
   *  released before signup are never force-served — a new member joining an
   *  established deck fills that backlog voluntarily via the answer grids'
   *  edit pencil (help-system arc CP1). Wave-2 cards are EXCLUDED from the
   *  drip — wave 2 always arrives through its reserved moments (onboarding
   *  completion / first group-room click), so the drip can't preempt them. */
  wave: 1 | 2 | "drip";
  /** "welcome" = the §12.4 Wave-1 copy block; "more" = the §12.5 "a few
   *  more…" H1; "none" = bare card (the drip modal, per mockup). */
  heading: "welcome" | "more" | "none";
  idiom: "desktop" | "mobile";
  /** Serve only if every earlier-wave card is answered. Used by the
   *  group-room wave-2 trigger so an account still owed wave 1 (an existing
   *  user pre-catch-up) isn't served out of order — their catch-up runs
   *  through the drip modal instead. */
  requirePriorWave?: boolean;
  /** Serve this card FIRST (onboarding changeset §3 — the invitee's wave 1
   *  must open on the card quoted in the invite email). */
  leadCardId?: string;
  /** Pre-account mode (changeset §5): no signed-in user required — answers
   *  park in localStorage and are claimed by the next sign-in on this
   *  browser (see lib/deckPending). Used at the invitee's door, wave 1. */
  anonymous?: boolean;
  onComplete: () => void;
}) {
  const { user } = useAuth();
  const [queue, setQueue] = useState<DeckCard[] | null>(null); // null = loading
  const [idx, setIdx] = useState(0);
  // Answering slides the card out toward the chosen tab (NOPE → left,
  // YES → right) before the next card fades in (Alborz QA 2026-07-18 —
  // replaces the old vertical entrance motion).
  const [exit, setExit] = useState<"left" | "right" | null>(null);
  const doneRef = useRef(false);
  // Mobile drag-to-swipe: dragX follows the finger; past the threshold the
  // card is "flung" (transitioned off-screen) instead of keyframe-exited.
  const SWIPE_COMMIT_PX = 80;
  const [dragX, setDragX] = useState(0);
  const [flung, setFlung] = useState<"left" | "right" | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!anonymous && !user) return;
    let cancelled = false;
    (async () => {
      const [cards, answers] = await Promise.all([
        fetchDeckCards(),
        anonymous ? Promise.resolve(readPendingDeckAnswers()) : fetchMyDeckAnswers(user!.id),
      ]);
      if (cancelled) return;
      if (wave === "drip") {
        const key = `ns_deck_drip_${user!.id}`;
        try { if (sessionStorage.getItem(key)) { setQueue([]); return; } } catch { /* tolerate */ }
        // The once-per-session flag is stamped on COMPLETION (see answer()),
        // not on serve — a mid-batch refresh brings the cards back (there is
        // no dismissal, incl. by reload).
        // Signup anchor: only cards released while this account existed are
        // owed to the drip; pre-signup releases stay as fillable blanks in
        // the grids. (All pre-deck accounts predate every release, so their
        // catch-up behavior is unchanged.)
        const joinedAt = user!.created_at ? new Date(user!.created_at).getTime() : 0;
        setQueue(cards
          .filter((c) => c.wave !== 2 && !(c.id in answers) && c.releasedAt > joinedAt)
          .slice(0, 4)); // fetchDeckCards is already in serve order (oldest first)
        return;
      }
      if (requirePriorWave && cards.some((c) => c.wave != null && c.wave < wave && !(c.id in answers))) {
        setQueue([]);
        return;
      }
      let q = cards.filter((c) => c.wave === wave && !(c.id in answers));
      if (leadCardId) q = [...q.filter((c) => c.id === leadCardId), ...q.filter((c) => c.id !== leadCardId)];
      setQueue(q);
    })();
    return () => { cancelled = true; };
  }, [user, wave, requirePriorWave, leadCardId, anonymous]);

  // Nothing to serve → complete silently (once).
  useEffect(() => {
    if (queue !== null && queue.length === 0 && !doneRef.current) {
      doneRef.current = true;
      onComplete();
    }
  }, [queue, onComplete]);

  if ((!anonymous && !user) || queue === null || queue.length === 0) return null;
  const card = queue[Math.min(idx, queue.length - 1)];
  const mobile = idiom === "mobile";

  function answer(agreed: boolean, viaSwipe = false) {
    if ((!anonymous && !user) || doneRef.current || exit || flung) return;
    if (anonymous) {
      addPendingDeckAnswer(card.id, agreed);
    } else {
      upsertDeckAnswer({ userId: user!.id, cardId: card.id, answer: agreed })
        .catch((e) => console.warn("[deck] answer write failed (drip will re-serve):", e));
    }
    // Swipe answers keep the drag transform and transition off-screen from
    // where the finger left the card; tap answers use the keyframe exit.
    if (viaSwipe) setFlung(agreed ? "right" : "left"); else setExit(agreed ? "right" : "left");
    window.setTimeout(() => {
      setExit(null);
      setFlung(null);
      setDragX(0);
      if (idx + 1 < queue!.length) { setIdx(idx + 1); return; }
      doneRef.current = true;
      // Drip batch completed → don't serve another this session (4 per login).
      if (wave === "drip") { try { sessionStorage.setItem(`ns_deck_drip_${user!.id}`, "1"); } catch { /* tolerate */ } }
      onComplete();
    }, 240);
  }

  return (
    <div style={{
      ...dimWrap,
      background: mobile ? "rgba(26,58,74,0.35)" : "rgba(26,58,74,0.25)",
      zIndex: mobile ? 1000 : 900,
      // Mobile: anchor BELOW the page chrome so the heading can't overlap
      // the logo/top bar showing through the dim (Alborz QA 2026-07-18).
      ...(mobile ? { alignItems: "flex-start", paddingTop: "calc(env(safe-area-inset-top, 0px) + 84px)" } : {}),
    }}>
      <div style={{ width: mobile ? "calc(100% - 40px)" : "min(880px, 88vw)", maxHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {heading === "welcome" && (
          <div style={{ textAlign: "left", marginBottom: mobile ? 20 : 28 }}>
            <h1 style={{ ...h1Style, fontSize: mobile ? 28 : 34 }}>Welcome to Sidebar, a place for you and your friends to talk about TV, spoiler-free.</h1>
            <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: mobile ? 14 : 15, color: CANON.cream, marginTop: 10, lineHeight: 1.45 }}>
              Before you get set up, a few questions<br />to get you in the mood for TV.
            </div>
            <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 13, color: CANON.cream, marginTop: 14 }}>
              (Your friends will answer these too.)
            </div>
          </div>
        )}
        {heading === "more" && (
          <div style={{ textAlign: "left", marginBottom: mobile ? 16 : 20 }}>
            {/* Header 2 styling (Inter bold 14) per Alborz QA 2026-07-18. */}
            <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: CANON.cream }}>a few more&hellip;</div>
          </div>
        )}

        <div
          key={card.id}
          onTouchStart={mobile ? (e) => {
            if (exit || flung) return;
            dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          } : undefined}
          onTouchMove={mobile ? (e) => {
            if (!dragStart.current || flung) return;
            setDragX(e.touches[0].clientX - dragStart.current.x);
          } : undefined}
          onTouchEnd={mobile ? () => {
            if (!dragStart.current || flung) return;
            dragStart.current = null;
            if (Math.abs(dragX) > SWIPE_COMMIT_PX) answer(dragX > 0, true);
            else setDragX(0); // under threshold → spring back
          } : undefined}
          onTouchCancel={mobile ? () => { dragStart.current = null; setDragX(0); } : undefined}
          style={{
            ...cardStyle,
            height: mobile ? "min(500px, 55dvh)" : "min(580px, 66vh)",
            // Own the touch gesture — no scroll/rubber-band competition.
            ...(mobile ? { touchAction: "none" as const } : {}),
            // Swipe visuals: follow the finger with a slight tilt; flung
            // cards transition off-screen FROM the drag position (the
            // keyframe exit stays for tap answers).
            transform: flung
              ? `translateX(${flung === "right" ? "120vw" : "-120vw"}) rotate(${flung === "right" ? 14 : -14}deg)`
              : dragX !== 0
                ? `translateX(${dragX}px) rotate(${dragX / 18}deg)`
                : undefined,
            // Sticky when idle so the spring-back (transform removed on the
            // reset render) still animates; "none" only while the finger is
            // down so the card tracks it 1:1.
            transition: flung
              ? "transform .24s ease"
              : dragStart.current != null ? "none" : "transform .18s ease",
            animation: exit
              ? `${exit === "right" ? "deckExitRight" : "deckExitLeft"} .22s ease forwards`
              : flung || dragX !== 0
                ? undefined
                : "deckCardIn .24s ease",
          }}
        >
          <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 30 : 38, lineHeight: 1.25, color: CANON.identity, textAlign: "center", maxWidth: mobile ? "82%" : "58%" }}>
            {card.statement}
          </div>

          {/* Mobile tabs sit in the card's extreme corners, smaller — the
              statement keeps Header-1 size and stays clear of them
              (Alborz QA 2026-07-18). */}
          <button
            style={{ ...tab, background: CANON.alert, ...(mobile ? { ...tabMobile, top: 20, left: -14 } : { top: "50%", transform: "translateY(-50%)", left: -30 }) }}
            onClick={() => answer(false)}
          >
            NOPE <ArrowLeft size={mobile ? 18 : 22} strokeWidth={2.5} />
          </button>
          <button
            style={{ ...tab, background: CANON.personal, ...(mobile ? { ...tabMobile, bottom: 24, right: -14 } : { top: "50%", transform: "translateY(-50%)", right: -30 }) }}
            onClick={() => answer(true)}
          >
            <ArrowRight size={mobile ? 18 : 22} strokeWidth={2.5} /> YES
          </button>
        </div>
      </div>
      <style>{`
        @keyframes deckCardIn { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
        @keyframes deckExitRight { to { opacity: 0; transform: translateX(140px) rotate(2deg); } }
        @keyframes deckExitLeft { to { opacity: 0; transform: translateX(-140px) rotate(-2deg); } }
      `}</style>
    </div>
  );
}

const dimWrap: React.CSSProperties = {
  position: "fixed", inset: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 20, boxSizing: "border-box",
};
const h1Style: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, lineHeight: 1.2, letterSpacing: 0, color: CANON.cream, margin: 0,
};
const cardStyle: React.CSSProperties = {
  position: "relative", background: CANON.cream, borderRadius: 24,
  boxShadow: "0 12px 36px rgba(0,0,0,0.25)",
  display: "flex", alignItems: "center", justifyContent: "center",
};
// No drop shadow — the tabs read as PART of the card, stamped across its
// edge, not elements floating above it (Alborz QA 2026-07-18).
const tab: React.CSSProperties = {
  position: "absolute", border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", gap: 10,
  color: CANON.cream, fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: 0.5,
  padding: "18px 26px", borderRadius: 65, minHeight: 48,
};
const tabMobile: React.CSSProperties = {
  padding: "12px 20px", fontSize: 13, minHeight: 40, gap: 8,
};
