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
 * blocking; the drip catch-up re-serves any card that didn't stick). Tap
 * targets only for now; drag-to-swipe is a flagged nice-to-have.
 *
 * Tabs break the card's edges per the mockups: desktop NOPE/YES at
 * mid-height left/right; mobile diagonal (NOPE top-left, YES bottom-right).
 * The page dims behind the card everywhere (Alborz, CP0 review).
 */
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { fetchDeckCards, fetchMyDeckAnswers, upsertDeckAnswer, type DeckCard } from "../../lib/db";
import { CANON } from "../../styles/canon";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export default function DeckWave({ wave, heading, idiom, requirePriorWave, onComplete }: {
  wave: 1 | 2;
  /** "welcome" = the §12.4 Wave-1 copy block; "more" = the §12.5 "a few more…" H1. */
  heading: "welcome" | "more";
  idiom: "desktop" | "mobile";
  /** Serve only if every earlier-wave card is answered. Used by the
   *  group-room wave-2 trigger so an account still owed wave 1 (an existing
   *  user pre-catch-up) isn't served out of order — their catch-up runs
   *  through the drip modal instead. */
  requirePriorWave?: boolean;
  onComplete: () => void;
}) {
  const { user } = useAuth();
  const [queue, setQueue] = useState<DeckCard[] | null>(null); // null = loading
  const [idx, setIdx] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [cards, answers] = await Promise.all([fetchDeckCards(), fetchMyDeckAnswers(user.id)]);
      if (cancelled) return;
      if (requirePriorWave && cards.some((c) => c.wave != null && c.wave < wave && !(c.id in answers))) {
        setQueue([]);
        return;
      }
      setQueue(cards.filter((c) => c.wave === wave && !(c.id in answers)));
    })();
    return () => { cancelled = true; };
  }, [user, wave, requirePriorWave]);

  // Nothing to serve → complete silently (once).
  useEffect(() => {
    if (queue !== null && queue.length === 0 && !doneRef.current) {
      doneRef.current = true;
      onComplete();
    }
  }, [queue, onComplete]);

  if (!user || queue === null || queue.length === 0) return null;
  const card = queue[Math.min(idx, queue.length - 1)];
  const mobile = idiom === "mobile";

  function answer(agreed: boolean) {
    if (!user || doneRef.current) return;
    upsertDeckAnswer({ userId: user.id, cardId: card.id, answer: agreed })
      .catch((e) => console.warn("[deck] answer write failed (drip will re-serve):", e));
    if (idx + 1 < queue!.length) setIdx(idx + 1);
    else { doneRef.current = true; onComplete(); }
  }

  return (
    <div style={{ ...dimWrap, background: mobile ? "rgba(26,58,74,0.35)" : "rgba(26,58,74,0.25)", zIndex: mobile ? 1000 : 900 }}>
      <div style={{ width: mobile ? "calc(100% - 40px)" : "min(880px, 88vw)", maxHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {heading === "welcome" ? (
          <div style={{ textAlign: "left", marginBottom: mobile ? 20 : 28 }}>
            <h1 style={{ ...h1Style, fontSize: mobile ? 28 : 34 }}>Welcome to Sidebar.</h1>
            <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: mobile ? 14 : 15, color: CANON.cream, marginTop: 10, lineHeight: 1.45 }}>
              Before you get set up, a few questions<br />to get you in the mood for TV.
            </div>
            <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 13, color: CANON.cream, marginTop: 14 }}>
              (Your friends will answer these too.)
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "left", marginBottom: mobile ? 20 : 28 }}>
            <h1 style={{ ...h1Style, fontSize: mobile ? 28 : 34 }}>a few more&hellip;</h1>
          </div>
        )}

        <div key={card.id} style={{ ...cardStyle, height: mobile ? "min(560px, 60dvh)" : "min(540px, 64vh)", animation: "deckCardIn .28s ease" }}>
          <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 30 : 36, lineHeight: 1.25, color: CANON.identity, textAlign: "center", maxWidth: mobile ? "82%" : "58%" }}>
            {card.statement}
          </div>

          <button
            style={{ ...tab, background: CANON.alert, ...(mobile ? { top: 76, left: -14 } : { top: "50%", transform: "translateY(-50%)", left: -30 }) }}
            onClick={() => answer(false)}
          >
            NOPE <ArrowLeft size={22} strokeWidth={2.5} />
          </button>
          <button
            style={{ ...tab, background: CANON.personal, ...(mobile ? { bottom: 84, right: -14 } : { top: "50%", transform: "translateY(-50%)", right: -30 }) }}
            onClick={() => answer(true)}
          >
            <ArrowRight size={22} strokeWidth={2.5} /> YES
          </button>
        </div>
      </div>
      <style>{`@keyframes deckCardIn { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }`}</style>
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
const tab: React.CSSProperties = {
  position: "absolute", border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", gap: 10,
  color: CANON.cream, fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: 0.5,
  padding: "18px 26px", borderRadius: 65, minHeight: 48,
  boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
};
