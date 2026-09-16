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
import { useAuth } from "../../lib/auth";
import { fetchDeckCards, fetchMyDeckAnswers, fetchMyLastDeckAnswerAt, upsertDeckAnswer, type DeckCard } from "../../lib/db";
import { readPendingDeckAnswers, addPendingDeckAnswer } from "../../lib/deckPending";
import { CANON } from "../../styles/canon";
import { M } from "../../mobile/m";
import { D } from "../dashboardChrome";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

/** PERSONAL SCHEDULE (Alborz, 2026-08-01). Your next batch is due this long
 *  after you last answered new questions — your own clock, not a site-wide
 *  calendar. A new account's anchor is its onboarding answers, so the first
 *  drip naturally lands one interval after signup (no separate grace rule). */
const DRIP_INTERVAL_DAYS = 14;
const DRIP_INTERVAL_MS = DRIP_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

export default function DeckWave({ wave, heading, idiom, requirePriorWave, leadCardId, anonymous, onComplete }: {
  /** 1 | 2 = the fixed onboarding waves. "drip" (CP4) = the catch-up/drip
   *  modal: up to 4 of the viewer's unanswered cards, oldest first, at most
   *  once per session (sessionStorage flag).
   *
   *  PERSONAL SCHEDULE (Alborz, 2026-08-01 — replaces BOTH the global drip
   *  calendar and help-system CP1's signup anchor). Everyone walks the SAME
   *  ordered deck, but at their own pace: your next 4 are due
   *  DRIP_INTERVAL_DAYS after you last answered new questions. Release dates
   *  no longer pace anything — `released_at` survives only as a live/not-yet
   *  flag on the card itself (fetchDeckCards filters it), so unfinished
   *  questions can still be held back from everyone.
   *
   *  WHY (Alborz's call): under a global calendar the deck burns down on
   *  wall-clock time — a day-0 member gets ~26 weeks of new-question
   *  moments while someone joining after the calendar exhausts burns the
   *  whole deck in a few weeks and is then dry forever. Personal pacing
   *  makes the authored deck a full-length program for EVERY user who ever
   *  joins, so the writing keeps paying off instead of expiring. Accepted
   *  costs: no shared release moment, and a late joiner converges on their
   *  friends' answers more slowly (their answers are a prefix of the same
   *  ordered list, so findings still work — they just deepen over time).
   *
   *  Filling cells with the grid's edit pencil still removes those cards
   *  from the drip — one answer record, wherever it was given — and also
   *  moves your pacing anchor, since you just answered new questions.
   *
   *  Wave-2 cards are DRIPPABLE as of 2026-08-01 (Alborz). They used to be
   *  excluded so the drip couldn't preempt wave 2's reserved moments
   *  (onboarding completion / first group-room click) — but the interval
   *  guard above now does that job on its own: a fresh account's anchor is
   *  its signup/wave-1 answers, so the drip cannot fire during onboarding
   *  (minutes) or anywhere near it. The only case that reaches a wave-2 card
   *  through the drip is someone whose reserved moment never came AND who
   *  has been idle a full interval — an invitee who never opened a group
   *  room, or any account whose answers were wiped. Serving them beats
   *  stranding the cards as blanks only the grid pencil could reach. */
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
  // Cards answered during THIS mount. The queue is rebuilt from a fresh
  // answers read whenever the load effect re-runs, and the immediate write
  // is fire-and-forget — so without this, a re-run could re-serve a card the
  // viewer just swiped (the 2026-07-29 duplicate-card report).
  const answeredRef = useRef<Set<string>>(new Set());
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
  // Pass 3: one caption under the first card teaches the gesture; it hides
  // after the first answer (this mount).
  const [hasAnswered, setHasAnswered] = useState(false);
  // Desktop advertises "← / →" in that caption, so the keys actually work:
  // ← = NOPE, → = YES. Ref indirection keeps the listener registered above
  // the early returns while always calling the current card's answer().
  const answerRef = useRef<(agreed: boolean) => void>(() => {});
  useEffect(() => {
    if (idiom === "mobile") return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") answerRef.current(false);
      else if (e.key === "ArrowRight") answerRef.current(true);
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [idiom]);

  const userId = user?.id;
  const userCreatedAt = user?.created_at;
  useEffect(() => {
    if (!anonymous && !user) return;
    // Finished waves stay finished. A rebuild after completion used to render
    // a card whose clicks were swallowed by the doneRef guard in answer() —
    // the "stuck card, had to refresh" half of the same report.
    if (doneRef.current) return;
    let cancelled = false;
    (async () => {
      const [cards, answers, lastAnsweredAt] = await Promise.all([
        fetchDeckCards(),
        anonymous ? Promise.resolve(readPendingDeckAnswers()) : fetchMyDeckAnswers(user!.id),
        // Pacing anchor — only the drip needs it.
        !anonymous && wave === "drip" ? fetchMyLastDeckAnswerAt(user!.id) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (wave === "drip") {
        const key = `ns_deck_drip_${user!.id}`;
        try { if (sessionStorage.getItem(key)) { setQueue([]); return; } } catch { /* tolerate */ }
        // The once-per-session flag is stamped on COMPLETION (see answer()),
        // not on serve — a mid-batch refresh brings the cards back (there is
        // no dismissal, incl. by reload).
        // Personal pacing: due one interval after you last answered new
        // questions (or after signup, if you never have). A lapsed member
        // resumes the normal rhythm rather than being flooded on return.
        const joinedAt = user!.created_at ? new Date(user!.created_at).getTime() : 0;
        const anchor = lastAnsweredAt ?? joinedAt;
        if (anchor && Date.now() - anchor < DRIP_INTERVAL_MS) { install([]); return; }
        // Everyone walks the same ordered deck; take the next 4 you owe.
        // Nothing is ever out of reach — a member who joins years in still
        // gets the whole deck, just from their own starting line, and that
        // now includes the onboarding-reserved cards (see below).
        install(cards
          .filter((c) => !(c.id in answers))
          .slice(0, 4)); // fetchDeckCards is already in serve order
        return;
      }
      if (requirePriorWave && cards.some((c) => c.wave != null && c.wave < wave && !(c.id in answers))) {
        install([]);
        return;
      }
      let q = cards.filter((c) => c.wave === wave && !(c.id in answers));
      if (leadCardId) q = [...q.filter((c) => c.id === leadCardId), ...q.filter((c) => c.id !== leadCardId)];
      install(q);

      /** Install a freshly-built queue: drop anything already answered this
       *  mount, and restart the cursor (the old code left `idx` pointing into
       *  the previous queue, which could skip or repeat a card). */
      function install(next: DeckCard[]) {
        const remaining = next.filter((c) => !answeredRef.current.has(c.id));
        setQueue(remaining);
        setIdx(0);
      }
    })();
    return () => { cancelled = true; };
    // Keyed on the user's ID, not the user OBJECT — the object gets a new
    // identity on every token refresh, which re-ran this mid-wave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, userCreatedAt, wave, requirePriorWave, leadCardId, anonymous]);

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
  answerRef.current = (agreed) => answer(agreed);

  function answer(agreed: boolean, viaSwipe = false) {
    if ((!anonymous && !user) || doneRef.current || exit || flung) return;
    setHasAnswered(true);
    answeredRef.current.add(card.id);
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
      // Self-hide (Alborz's 2026-08-11 stuck-card report): the drip mounts
      // pass a no-op onComplete, so without this the last card stayed
      // rendered with every tap/swipe swallowed by the doneRef guard —
      // locked until refresh. Waves 1/2 unmount via their parents anyway.
      setQueue([]);
      onComplete();
    }, 240);
  }

  return (
    <div style={{
      ...dimWrap,
      background: mobile ? "rgba(26,58,74,0.35)" : "rgba(26,58,74,0.25)",
      zIndex: mobile ? 1000 : 900,
      // Mobile: anchor BELOW the page chrome so the heading can't overlap
      // the logo/top bar showing through the dim (Alborz QA 2026-07-18), and
      // SCROLL when heading + card outrun the screen (Alborz 2026-08-11 —
      // the card used to flex-shrink to fit, pushing the statement under the
      // corner tabs).
      // Pass 3: welcome top padding 128 → 72 — the dim covers the page and
      // /m has no top bar under the wave, so nothing to clear anymore.
      ...(mobile ? { alignItems: "flex-start", paddingTop: `calc(env(safe-area-inset-top, 0px) + ${heading === "welcome" ? 72 : 84}px)`, overflowY: "auto" as const, WebkitOverflowScrolling: "touch" as const } : {}),
    }}>
      <div style={{ width: mobile ? "calc(100% - 40px)" : "min(880px, 88vw)", display: "flex", flexDirection: "column", justifyContent: "center", ...(mobile ? {} : { maxHeight: "100%" }) }}>
        {/* Welcome copy (pass 3, 2026-09-15): Display heading (dash dropped),
            Body tagline wrapping naturally, setup note 13 at 0.85 with the
            parentheses gone. Both platforms via the token scales. */}
        {heading === "welcome" && (
          <div style={{ textAlign: "left", marginBottom: mobile ? 20 : 28, flexShrink: 0 }}>
            <h1 style={{ ...(mobile ? M.type.display : D.type.display), color: CANON.cream, margin: 0 }}>Welcome to Sidebar</h1>
            <div style={{ ...(mobile ? M.type.body : D.type.body), color: CANON.cream, marginTop: 10 }}>
              A place for you and your friends to talk about TV, spoiler-free.
            </div>
            <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, color: CANON.cream, opacity: 0.85, marginTop: 14, lineHeight: 1.5 }}>
              Before you get set up, a few questions to get you in the mood for TV. Your friends will answer these too.
            </div>
          </div>
        )}
        {/* "a few more…" moved INSIDE the first card (Alborz 2026-08-01) —
            see the in-card block below; the outside heading is gone. */}

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
            // Never shrink to fit — the mobile wrapper scrolls instead
            // (Alborz 2026-08-11; squeezing pushed the statement under the
            // corner tabs on small screens).
            flexShrink: 0,
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
          <div style={{ maxWidth: mobile ? "82%" : "58%", textAlign: "center" }}>
            {/* Wave-2 heading rides DIRECTLY above the question (Alborz
                2026-08-11; was pinned to the card's top edge) — Header-2
                font in Identity, FIRST card only. */}
            {heading === "more" && idx === 0 && (
              <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: CANON.identity, marginBottom: mobile ? 12 : 16 }}>
                a few more&hellip;
              </div>
            )}
            <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 30 : 38, lineHeight: 1.25, color: CANON.identity }}>
              {card.statement}
            </div>
          </div>

          {/* Batch position (pass 3: "1/4" bold → "1 of 4" caption at 0.7 —
              the bold fraction competed with the statement). */}
          <div style={{ position: "absolute", bottom: mobile ? 16 : 20, left: 0, right: 0, textAlign: "center", fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, color: CANON.identity, opacity: 0.7, pointerEvents: "none" }}>
            {Math.min(idx, queue.length - 1) + 1} of {queue.length}
          </div>

          {/* Mobile tabs sit in the card's extreme corners, smaller — the
              statement keeps Header-1 size and stays clear of them
              (Alborz QA 2026-07-18). */}
          <button
            style={{ ...tab, background: CANON.alert, ...(mobile ? { ...tabMobile, top: 20, left: -14 } : { top: "50%", transform: "translateY(-50%)", left: -30 }) }}
            onClick={() => answer(false)}
          >
            NOPE
          </button>
          <button
            style={{ ...tab, background: CANON.personal, ...(mobile ? { ...tabMobile, bottom: 24, right: -14 } : { top: "50%", transform: "translateY(-50%)", right: -30 }) }}
            onClick={() => answer(true)}
          >
            YES
          </button>
        </div>

        {/* Pass 3: one caption teaches the gesture on the welcome wave,
            gone after the first answer. Desktop names the arrow keys the
            keydown listener above actually serves. */}
        {heading === "welcome" && !hasAnswered && (
          <div style={{ textAlign: "center", marginTop: 14, flexShrink: 0, fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, lineHeight: 1.45, color: CANON.cream }}>
            {mobile ? "Swipe, or tap a stamp" : "Tap a stamp, or use ← / →"}
          </div>
        )}
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
const cardStyle: React.CSSProperties = {
  position: "relative", background: CANON.cream, borderRadius: 24,
  boxShadow: "0 12px 36px rgba(0,0,0,0.25)",
  display: "flex", alignItems: "center", justifyContent: "center",
};
// No drop shadow — the tabs read as PART of the card, stamped across its
// edge, not elements floating above it (Alborz QA 2026-07-18).
// Pass 3: radius 65 → 9999 (full stadium); mobile min-height 40 → 44
// (thumb target). Weight 800 / 0.5 tracking / corner placement are the
// deck's stamp idiom — unchanged.
const tab: React.CSSProperties = {
  position: "absolute", border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", gap: 10,
  color: CANON.cream, fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: 0.5,
  padding: "18px 26px", borderRadius: 9999, minHeight: 48,
};
const tabMobile: React.CSSProperties = {
  padding: "12px 20px", fontSize: 13, minHeight: 44, gap: 8,
};
