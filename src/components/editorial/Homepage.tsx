/**
 * Homepage.tsx — the logged-out homepage under the editorial skin
 * (checkpoint 8, 2026-10-12; the E3Home / E3Scroll / D3Home boards and the
 * bible's StepDiscs + PaperNote). The words come from lib/homepageCopy as
 * before; the scroll on green is `HomepageNarrative editorial`.
 */
import React, { useState } from "react";
import { E } from "../../styles/editorial";
import { HERO_LINES, HERO_EMPHASIS, HOW_IT_WORKS_STEPS, CTA_JOIN_LABEL, CTA_DETAILS_LABEL, BETA_PILL_CLOSED, BETA_PILL_OPEN, BETA_LETTER_PARAGRAPHS, BETA_LETTER_PARAGRAPHS_MOBILE } from "../../lib/homepageCopy";
import { SectionHead } from "./Chrome";
import { Block, Frame, COLUMN } from "./Onboarding";
import { CornerTab } from "./Chrome";
import { PAPER_RULES, PAPER_LH } from "./Compose";
import { EditorialSheet } from "./GroupRoom";
import HomepageNarrative from "../HomepageNarrative";

/** The five discs take the palette in order; the number is cream on identity and alert, ink on the rest. */
const DISC = [
  { bg: E.color.identity, fg: E.color.cream },
  { bg: E.color.friend, fg: E.color.ink },
  { bg: E.color.accent, fg: E.color.ink },
  { bg: E.color.alert, fg: E.color.cream },
  { bg: E.color.personal, fg: E.color.ink },
];

/** HOW IT WORKS: five hairline rows, a numbered disc, an outline glyph, one sentence; the last closes on an ink rule. */
export function StepRows({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <SectionHead right={<span style={{ color: E.color.inkMuted }}>{HOW_IT_WORKS_STEPS.length} steps</span>}>How it works</SectionHead>
      {HOW_IT_WORKS_STEPS.map(({ Icon, text }, i) => {
        const last = i === HOW_IT_WORKS_STEPS.length - 1;
        const d = DISC[i % DISC.length];
        return (
          <div key={i} style={{ display: "flex", gap: 14, padding: "16px 0", borderBottom: `1px solid ${last ? E.color.ink : E.color.hairline}` }}>
            <span style={{ ...E.type.label10, flexShrink: 0, width: 26, height: 26, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: d.bg, color: d.fg, marginTop: -2 }}>{String(i + 1).padStart(2, "0")}</span>
            <Icon size={20} color={E.color.ink} strokeWidth={1.3} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            <span style={{ ...E.type.body15, color: E.color.ink }}>{text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The hero in Lora and the "Not on Sidebar." sticker. */
export function Hero({ desktop = false }: { desktop?: boolean }) {
  return (
    <div>
      <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: desktop ? 52 : 36, lineHeight: desktop ? 1.08 : 1.1, letterSpacing: "-0.01em", maxWidth: desktop ? 720 : 320, color: E.color.ink }}>
        {HERO_LINES[0]} {HERO_LINES[1]}
      </div>
      <div style={{ marginTop: desktop ? 22 : 18, display: "inline-block", padding: desktop ? "8px 18px" : "8px 16px", background: E.color.accent, fontFamily: E.font.display, fontStyle: "italic", fontWeight: 700, fontSize: desktop ? 34 : 28, letterSpacing: "-0.01em", transform: "rotate(-3deg)", color: E.color.ink }}>
        {HERO_EMPHASIS}
      </div>
    </div>
  );
}

/** The beta tester's letter on ruled cream paper. */
function Letter({ paragraphs, style }: { paragraphs: string[]; style?: React.CSSProperties }) {
  return (
    <div style={{ background: E.color.cream, padding: "28px 34px 22px", boxSizing: "border-box", ...style }}>
      <div style={{ fontFamily: E.font.display, fontSize: 16, lineHeight: `${PAPER_LH}px`, color: E.color.ink, backgroundImage: PAPER_RULES, backgroundSize: `100% ${PAPER_LH}px`, backgroundRepeat: "repeat" }}>
        {paragraphs.map((p, i) => (
          <p key={i} style={{ margin: i === paragraphs.length - 1 ? 0 : `0 0 ${PAPER_LH}px`, fontStyle: i === paragraphs.length - 1 ? "italic" : undefined }}>{p}</p>
        ))}
      </div>
    </div>
  );
}

/** The desktop's beta band at the page's foot: the live two-part switch, the letter opening inside the band. */
export function BetaBand({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div style={{ background: E.color.accent, padding: "40px 24px 48px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <button type="button" role="switch" aria-checked={open} aria-label="Beta tester letter" onClick={onToggle} style={{ display: "inline-flex", border: `1px solid ${E.color.ink}`, background: "transparent", padding: 0, cursor: "pointer", fontFamily: E.font.label, fontSize: 12, letterSpacing: "0.04em", color: E.color.ink }}>
          <span style={{ padding: "9px 14px", background: open ? "transparent" : E.color.ink, color: open ? E.color.ink : E.color.cream, fontWeight: open ? 400 : 500 }}>{BETA_PILL_CLOSED}</span>
          <span style={{ padding: "9px 14px", background: open ? E.color.ink : "transparent", color: open ? E.color.cream : E.color.ink, fontWeight: open ? 500 : 400 }}>{BETA_PILL_OPEN}</span>
        </button>
        {open && <Letter paragraphs={BETA_LETTER_PARAGRAPHS} style={{ width: E.measure.desktop.letters, maxWidth: "100%", marginTop: 32 }} />}
      </div>
    </div>
  );
}

/** The phone's paper note at the right, tilted, running off the edge; tapping opens the letter as a sheet. */
export function BetaNote({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} style={{ position: "relative", display: "block", boxSizing: "border-box", width: 206, marginLeft: "auto", marginRight: -30, padding: "12px 26px 13px 16px", background: E.color.cream, border: `1px solid ${E.color.ink}`, borderLeft: `5px solid ${E.color.accent}`, textAlign: "left", cursor: "pointer", transform: "rotate(-3deg)", color: E.color.ink, fontFamily: E.font.interface, fontSize: 13, lineHeight: 1.4 }}>
      <span style={{ display: "block", ...E.type.label9, color: E.color.inkMuted, marginBottom: 4 }}>Beta tester?</span>
      Tap here. There&rsquo;s a letter for you.
    </button>
  );
}

/** The whole logged-out homepage. */
export default function EditorialHomepage({ desktop = false, onSignIn, onJoin, onDetails, betaOpen, onToggleBeta, onFeedback }: {
  desktop?: boolean; onSignIn: () => void; onJoin: () => void; onDetails: () => void; betaOpen: boolean; onToggleBeta: () => void;
  /** Desktop (Alborz's notes, round 2): the red feedback corner at the top left, as on the dashboard. */
  onFeedback?: () => void;
}) {
  const [letterOpen, setLetterOpen] = useState(false);
  const col: React.CSSProperties = desktop ? { ...COLUMN, width: 912, maxWidth: "calc(100% - 48px)" } : {};
  // Sign in rides over the scroll's top in cream (round 6: the scroll is the
  // page's first section again, as on the classic page; the wordmark that
  // rode beside it is gone — his notes, 10-14).
  const signIn = (
    <button type="button" onClick={onSignIn} style={{ position: "absolute", top: desktop ? 34 : "calc(env(safe-area-inset-top, 0px) + 18px)", right: desktop ? E.measure.desktop.inside + 120 : 20, height: 36, padding: "0 14px", border: `1px solid ${E.color.cream}`, background: "transparent", color: E.color.cream, ...E.type.label11, display: "inline-flex", alignItems: "center", cursor: "pointer", zIndex: 3 }}>Sign in</button>
  );
  return (
    <div style={{ background: E.color.cream, color: E.color.ink, fontFamily: E.font.interface, minHeight: desktop ? "100vh" : "100dvh" }}>
      {desktop && onFeedback && <CornerTab desktop kind="feedback" label="Feedback" onClick={onFeedback} />}
      {/* The scroll on green FIRST (Alborz, round 6), Sign in over its top */}
      <div style={{ position: "relative", background: E.color.personal, color: E.color.cream, overflow: "hidden" }}>
        {signIn}
        <HomepageNarrative headerHeight={desktop ? 100 : 110} editorial phone={!desktop} />
        {/* The seam (his notes, 10-27, both platforms): the green fades into the
            cream over 240px under the logo; the hero starts 30px inside the tail. */}
        <div aria-hidden="true" style={{ height: 240, background: `linear-gradient(to bottom, ${E.color.personal}, ${E.color.cream})` }} />
      </div>
      {/* The cream page (his order, 10-14): the hero, How it works, the acts, then the beta letter at the foot */}
      <div style={{ position: "relative", padding: desktop ? 0 : `0 ${E.space.gutter}px 40px`, marginTop: -30 }}>
        <div style={col}>
          <Hero desktop={desktop} />
        </div>
        <div style={col}>
          <StepRows style={{ marginTop: desktop ? 64 : 56, ...(desktop ? { width: E.measure.desktop.letters, maxWidth: "100%" } : {}) }} />
        </div>
        {desktop ? (
          <>
            <div style={{ ...col, marginTop: 64, display: "flex", gap: 16, justifyContent: "center" }}>
              <Block onClick={onJoin} style={{ width: 320 }}>{CTA_JOIN_LABEL}</Block>
              <Frame onClick={onDetails} style={{ width: 320 }}>{CTA_DETAILS_LABEL}</Frame>
            </div>
            <div style={{ marginTop: 64 }}><BetaBand open={betaOpen} onToggle={onToggleBeta} /></div>
          </>
        ) : (
          <>
            <div style={{ margin: `44px -${E.space.gutter}px 0`, padding: `28px ${E.space.gutter}px 30px`, background: E.color.accent, display: "flex", flexDirection: "column", gap: 10 }}>
              <Block onClick={onJoin}>{CTA_JOIN_LABEL}</Block>
              <Frame onClick={onDetails}>{CTA_DETAILS_LABEL}</Frame>
            </div>
            <div style={{ marginTop: 26 }}><BetaNote onOpen={() => setLetterOpen(true)} /></div>
          </>
        )}
      </div>
      {letterOpen && (
        <EditorialSheet onClose={() => setLetterOpen(false)}>
          {/* Clear of the sheet's handle (his note, 10-27). */}
          <div style={{ ...E.type.label10, color: E.color.inkMuted, marginTop: 24 }}>A letter for beta testers</div>
          <Letter paragraphs={BETA_LETTER_PARAGRAPHS_MOBILE} style={{ padding: "16px 0 8px" }} />
        </EditorialSheet>
      )}
    </div>
  );
}
