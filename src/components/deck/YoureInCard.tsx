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
import React from "react";
import { ArrowRight } from "lucide-react";
import LoadingDots from "../LoadingDots";
import { CANON } from "../../styles/canon";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export type YoureInVariant =
  | { kind: "inviter"; showName: string; friendName: string }
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
  return (
    <div
      style={{ ...dimWrap, background: mobile ? "rgba(26,58,74,0.35)" : "rgba(26,58,74,0.25)", zIndex: mobile ? 1000 : 900 }}
      onClick={(e) => { if (onDismiss && !busy && e.target === e.currentTarget) onDismiss(); }}
    >
      <div style={{ ...cardStyle, width: mobile ? "calc(100% - 40px)" : "min(880px, 88vw)", height: mobile ? "min(680px, 78dvh)" : "min(590px, 72vh)", padding: mobile ? "56px 28px 40px" : "72px 64px 56px" }}>
        <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 30 : 34, letterSpacing: 0, color: CANON.accent, margin: 0 }}>
          You&rsquo;re in!
        </h1>

        <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 14, lineHeight: 1.6, color: CANON.identity, marginTop: 22, maxWidth: mobile ? "100%" : 460 }}>
          {variant.kind === "inviter" ? (
            <>
              <p style={{ margin: 0 }}>
                You&rsquo;ve now created a show room for <span style={alertSpan}>{variant.showName}</span>,
                invited <span style={alertSpan}>{variant.friendName}</span>, and{" "}
                <span style={alertSpan}>left some writing</span> for them to read.
              </p>
              <p style={{ margin: "16px 0 0" }}>Next, invite more friends you want to watch with.</p>
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

        <div style={{ position: "absolute", right: mobile ? 28 : 64, bottom: mobile ? 40 : 56, left: mobile ? 28 : "auto" }}>
          <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 30 : 34, lineHeight: 1.25, letterSpacing: 0, color: CANON.identity, textAlign: "right" }}>
            Sidebar is for you and<br />your friends.
          </div>
        </div>

        <button
          style={{ ...goTab, opacity: busy ? 0.7 : 1, ...(mobile ? { right: -20, top: "48%" } : { right: -36, top: 40 }) }}
          disabled={busy}
          onClick={onDone}
        >
          {busy ? <>one moment<LoadingDots /></> : <><ArrowRight size={24} strokeWidth={2.5} /> GET STARTED!</>}
        </button>
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
// The tab grammar: rounded LEFT, FLAT right — it breaks the card's right
// edge (§12.6 "breaking the card's right edge — same visual grammar as the
// NOPE/YES tabs"). No drop shadow: the tab is part of the card, not an
// element floating above it (Alborz QA 2026-07-18).
const goTab: React.CSSProperties = {
  position: "absolute", border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", gap: 12,
  background: CANON.identity, color: CANON.cream,
  fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: 0.5,
  padding: "22px 30px", borderRadius: "65px 0 0 65px", minHeight: 52,
};
