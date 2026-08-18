/**
 * YoureInCard — the onboarding confirmation as a CARD (swipe-deck arc CP2,
 * spec §12.6; replaces the old full-screen "You're in." confirm and the
 * invitee "Taking you to your dashboard…" interstitial).
 *
 * Matches the question-card shape and grammar: cream card over the dimmed
 * page; "GET STARTED!" is an Identity-blue tab breaking the card's RIGHT
 * edge (rounded left, flat right — same family as the NOPE/YES tabs).
 * Accent-yellow headline; body in Identity blue with the show name, friend
 * name, and "left some writing" in Alert; the closer line in Identity
 * serif, right-aligned.
 *
 * Two variants: inviter (post-onboarding — names the show + friend) and
 * invitee (post-accept — names the waiting friend).
 */
import React, { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import LoadingDots from "../LoadingDots";
import InviteLinkRow, { type InviteLink } from "../InviteLinkRow";
import { CANON } from "../../styles/canon";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export type YoureInVariant =
  /** inviteLinks (2026-08-18): the just-sent invites' links, one per friend,
   *  so the inviter can ALSO text them (same link as the email). */
  | { kind: "inviter"; showName: string; friendName: string; inviteLinks?: InviteLink[] }
  | { kind: "invitee"; friendName: string };

export default function YoureInCard({ variant, idiom, onDone, busy = false, errorText = null, onDismiss }: {
  variant: YoureInVariant;
  idiom: "desktop" | "mobile";
  onDone: () => void;
  /** GET STARTED! is mid-action (e.g. accepting the invite) — shows the
   *  animated dots + guards double-clicks. */
  busy?: boolean;
  /** Failure line under the body (the invite-accept errors), Alert color. */
  errorText?: string | null;
  /** When set, clicking the dim backs out (the invite-prompt usage — a
   *  mis-clicked cluster shouldn't trap the user). Omitted in the
   *  onboarding confirm, where GET STARTED! is the only exit. */
  onDismiss?: () => void;
}) {
  const mobile = idiom === "mobile";
  // Mobile swipe = GET STARTED! (Alborz 2026-08-11): the card follows the
  // finger like the question cards and a fling past the threshold — EITHER
  // direction — proceeds, same as tapping the tab. Applies everywhere the
  // card appears (incl. the invite-accept prompt — a swipe is no more
  // accidental than a tap).
  const SWIPE_COMMIT_PX = 80;
  const [dragX, setDragX] = useState(0);
  const [flung, setFlung] = useState<"left" | "right" | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  // The invite-accept usage works async after onDone (busy dots, possible
  // error line ON the card) — bring a flung card back so that state is
  // visible. The onboarding usage unmounts before this matters.
  useEffect(() => {
    if (busy || errorText) { setFlung(null); setDragX(0); }
  }, [busy, errorText]);
  return (
    <div
      style={{ ...dimWrap, background: mobile ? "rgba(26,58,74,0.35)" : "rgba(26,58,74,0.25)", zIndex: mobile ? 1000 : 900 }}
      onClick={(e) => { if (onDismiss && !busy && e.target === e.currentTarget) onDismiss(); }}
    >
      <div
        onTouchStart={mobile ? (e) => {
          if (busy || flung) return;
          dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } : undefined}
        onTouchMove={mobile ? (e) => {
          if (!dragStart.current || flung) return;
          setDragX(e.touches[0].clientX - dragStart.current.x);
        } : undefined}
        onTouchEnd={mobile ? () => {
          if (!dragStart.current || flung) return;
          dragStart.current = null;
          if (Math.abs(dragX) > SWIPE_COMMIT_PX && !busy) {
            setFlung(dragX > 0 ? "right" : "left");
            onDone();
          } else setDragX(0); // under threshold → spring back
        } : undefined}
        onTouchCancel={mobile ? () => { dragStart.current = null; setDragX(0); } : undefined}
        style={{
          ...cardStyle, width: mobile ? "calc(100% - 40px)" : "min(880px, 88vw)", height: mobile ? "min(680px, 78dvh)" : "min(590px, 72vh)", padding: mobile ? "56px 28px 40px" : "72px 64px 56px", ...(mobile ? { display: "flex", flexDirection: "column", touchAction: "none" as const } : {}),
          transform: flung
            ? `translateX(${flung === "right" ? "120vw" : "-120vw"}) rotate(${flung === "right" ? 14 : -14}deg)`
            : dragX !== 0
              ? `translateX(${dragX}px) rotate(${dragX / 18}deg)`
              : undefined,
          transition: flung
            ? "transform .24s ease"
            : dragStart.current != null ? "none" : "transform .18s ease",
        }}
      >
        <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 30 : 34, letterSpacing: 0, color: CANON.accent, margin: 0 }}>
          You&rsquo;re in!
        </h1>

        {/* The body may now carry one link row per friend (up to 7), so it
            scrolls past a cap instead of pushing GET STARTED! / the closer
            off the card. On mobile the card itself is touchAction:none for
            the swipe; pan-y here lets the body scroll under a finger. */}
        <div style={{
          fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 14, lineHeight: 1.6, color: CANON.identity, marginTop: 22,
          maxWidth: mobile ? "100%" : 460,
          overflowY: "auto", WebkitOverflowScrolling: "touch",
          ...(mobile ? { flexShrink: 1, minHeight: 0, touchAction: "pan-y" as const } : { maxHeight: 380 }),
        }}>
          {variant.kind === "inviter" ? (
            <>
              <p style={{ margin: 0 }}>
                You&rsquo;ve now created a show room for <span style={alertSpan}>{variant.showName}</span>,
                invited <span style={alertSpan}>{variant.friendName}</span>, and{" "}
                <span style={alertSpan}>left some writing</span> for them to read.
              </p>
              {/* Text-a-link (Alborz 2026-08-18): the same invite, offered as
                  a link the inviter can send themselves. */}
              {variant.inviteLinks && variant.inviteLinks.length > 0 && (
                <>
                  <p style={{ margin: "16px 0 0" }}>
                    Sidebar has emailed your {variant.inviteLinks.length > 1 ? "friends" : "friend"}. You can also text them an invite link.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {variant.inviteLinks.map((l) => <InviteLinkRow key={l.link} name={l.name} link={l.link} tone="cream" />)}
                  </div>
                </>
              )}
              <p style={{ margin: "16px 0 0" }}>Once you&rsquo;re in, you can invite more friends you want to watch with.</p>
            </>
          ) : (
            <p style={{ margin: 0 }}>
              Your friend, <span style={alertSpan}>{variant.friendName}</span> is waiting for you inside
              your group room. See what they&rsquo;ve written you already and let them know what you want
              to watch together.
            </p>
          )}
          {errorText && (
            <p style={{ margin: "16px 0 0", color: CANON.alert, fontWeight: 700 }}>{errorText}</p>
          )}
        </div>

        {/* Mobile layout (Alborz 2026-08-01): the card is a column — body,
            then GET STARTED! vertically centered in the FREE band between
            the body and the closer (it used to sit at 50% of the card and
            could overlap the body text), closer at the bottom. Desktop
            keeps its absolute layout. */}
        {mobile ? (
          <>
            {/* minHeight keeps the tab's band alive when the body is long
                (many invite-link rows) — the body scrolls instead. */}
            <div style={{ flex: 1, minHeight: 88, position: "relative" }}>
              <button
                style={{ ...goTab, opacity: busy ? 0.7 : 1, right: -48, top: "50%", transform: "translateY(-50%)", padding: "14px 24px", fontSize: 13.5, minHeight: 44 }}
                disabled={busy}
                onClick={onDone}
              >
                {busy ? <>one moment<LoadingDots /></> : <><ArrowRight size={18} strokeWidth={2.5} /> GET STARTED!</>}
              </button>
            </div>
            {/* Three-line arrangement on mobile (Alborz 2026-08-11);
                desktop keeps its two-line break. */}
            <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 30, lineHeight: 1.25, letterSpacing: 0, color: CANON.identity, textAlign: "right" }}>
              Sidebar is<br />for you and<br />your friends.
            </div>
          </>
        ) : (
          <>
            <div style={{ position: "absolute", right: 64, bottom: 56 }}>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 34, lineHeight: 1.25, letterSpacing: 0, color: CANON.identity, textAlign: "right" }}>
                Sidebar is for you and<br />your friends.
              </div>
            </div>
            <button
              style={{ ...goTab, opacity: busy ? 0.7 : 1, right: -36, top: 40 }}
              disabled={busy}
              onClick={onDone}
            >
              {busy ? <>one moment<LoadingDots /></> : <><ArrowRight size={24} strokeWidth={2.5} /> GET STARTED!</>}
            </button>
          </>
        )}
      </div>
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
  boxSizing: "border-box",
};
const alertSpan: React.CSSProperties = { color: CANON.alert, fontWeight: 700 };
// The tab grammar: a full stadium pill breaking the card's right edge —
// SAME shape as the NOPE/YES tabs (Alborz QA 2026-07-18; was flat-right).
// No drop shadow: the tab is part of the card, not floating above it.
const goTab: React.CSSProperties = {
  position: "absolute", border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", gap: 12,
  background: CANON.identity, color: CANON.cream,
  fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: 0.5,
  padding: "22px 30px", borderRadius: 65, minHeight: 52,
};
