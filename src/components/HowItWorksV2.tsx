import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import SidebarLogo from "./SidebarLogo";
import { CANON } from "../styles/canon";

// ── Types ──────────────────────────────────────────────────────────────────

type PillType = "your-post" | "post" | "reply" | "invisible";
type PillAlign = "left" | "right";
type SlotDef = { type: PillType; align: PillAlign };

const S = (type: PillType, align: PillAlign): SlotDef => ({ type, align });

// ── 12-slot panel end-states (YOUR POST always at slot 2) ─────────────────

export const panelSlots: (SlotDef | null)[][] = [
  // Panel 1: 5 pills at slots 2-6
  [null, null, S("your-post","left"), S("post","left"), S("reply","right"), S("reply","right"), S("post","left"), null, null, null, null, null],
  // Panel 2 (invisible pills pre-aligned to their panel 3 positions)
  [S("invisible","left"), S("invisible","right"), S("your-post","left"), S("invisible","right"), S("invisible","right"), S("invisible","left"), S("post","left"), S("reply","right"), S("invisible","right"), S("reply","right"), S("invisible","left"), S("post","left")],
  // Panel 3
  [S("invisible","left"), S("invisible","right"), S("your-post","left"), S("reply","right"), S("reply","right"), S("post","left"), S("post","left"), S("reply","right"), S("reply","right"), S("reply","right"), S("invisible","left"), S("post","left")],
  // Panel 4
  [S("post","left"), S("reply","right"), S("your-post","left"), S("reply","right"), S("reply","right"), S("post","left"), S("post","left"), S("reply","right"), S("reply","right"), S("reply","right"), S("post","left"), S("post","left")],
];

// Panel 2: maps current slot → previous slot for sliding green pills
const panel2SlideMap: Record<number, number> = { 6: 3, 7: 4, 9: 5, 11: 6 };

// ── Captions & titles ─────────────────────────────────────────────────────

export const panelTitles: (string | undefined)[] = [
  "HOW DO THE NO\u2011SPOILER\nMECHANICS WORK?",
  undefined,
  undefined,
  undefined,
];

export const panelCaptions: React.ReactNode[] = [
  <>
    Your friends have been watching a new show and invite you to their Sidebar room.
    {"\n\n"}
    You watch the first episode, log your watch progress, and write a post about your first impressions. There are a handful of posts to read in the room {"\u2014"} these were all written when your friends were also on episode 1.
    {"\n\n"}
    <em>But in reality{"\u2026"}</em>
  </>,
  <>
    There is a lot more activity in the room because the show has 4 episodes available. For now, you can{"\u2019"}t see anything written from beyond episode 1.
    {"\n\n"}
    Your friends have been updating their watch progress and writing. Soon enough, your post gets replies (even though you don{"\u2019"}t know it yet).
  </>,
  <>
    A few days later you watch episode 2 and more activity is revealed to you. Those replies to your episode 1 post feel like your friends just finished watching episode 2 along with you (because they wrote it after <em>they</em> watched episode 2).
  </>,
  <>
    No one ever writes {"\u201C"}I can{"\u2019"}t wait for you to watch{"\u2026\u201D"} or censors their excitement in any way. You all write as if you{"\u2019"}re watching together {"\u2014"} and the site makes that experience real.
    {"\n\n"}
    When you catch up, you{"\u2019"}ll be able to read everything.
  </>,
];

// Mobile-scroll caption variants (Alborz 2026-07-03): the trailing colons
// lead into the diagram that sits BELOW each caption in the vertical scroll
// (MobileHowItWorks); "But in reality..." moves from panel 1's cliffhanger to
// panel 2's opener, which reads better without the pager transition. Kept
// beside panelCaptions so a future rewording updates both sets together.
// Panel 3 is shared verbatim. Desktop rendering is untouched.
export const panelCaptionsMobile: React.ReactNode[] = [
  <>
    Your friends have been watching a new show and invite you to their Sidebar room.
    {"\n\n"}
    You watch the first episode, log your watch progress, and write a post about your first impressions. There are a handful of posts to read in the room {"\u2014"} these were all written when your friends were also on episode 1:
  </>,
  <>
    But in reality, there is a lot more activity in the room because the show has 4 episodes available. For now, you can{"\u2019"}t see anything written from beyond episode 1.
    {"\n\n"}
    Your friends have been updating their watch progress and writing. Soon enough, your post gets replies {"\u2014"} even though you can{"\u2019"}t see them yet:
  </>,
  panelCaptions[2],
  <>
    No one ever writes {"\u201c"}I can{"\u2019"}t wait for you to watch{"\u2026\u201d"} or censors their excitement in any way. You all write as if you{"\u2019"}re watching together. The site makes that experience real.
    {"\n\n"}
    When you catch up, you{"\u2019"}ll be able to read everything:
  </>,
];

// ── Colors & dimensions ───────────────────────────────────────────────────

const PAGE_BG = CANON.personal;
export const BOX_BG = "rgba(253,248,236,0.92)";
const GREEN = CANON.personal;
const RED = CANON.alert;
const BORDER_W = 3;
const PILL_W = 170;
const PILL_H = 34;
const INDENT = 16;
export const SLOT_H = 40;
export const NUM_SLOTS = 12;

// ── Animation timing ──────────────────────────────────────────────────────

const VISIBLE_STAGGER = 0.15;
const VISIBLE_DURATION = 0.5;
const INVISIBLE_DURATION = 2;
const PHASE_DELAY = 500;
const SLIDE_DURATION = 1.0;
const MORPH_DURATION = 0.6;

// ── Keyframes ─────────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes hiw-rise {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes hiw-flicker-red {
  0%   { opacity: 0; }
  33%  { opacity: 0.44; }
  66%  { opacity: 0.20; }
  100% { opacity: 0.74; }
}
`;

let injected = false;
function injectKeyframes() {
  if (injected) return;
  injected = true;
  const el = document.createElement("style");
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
}

// ── Pill helpers ──────────────────────────────────────────────────────────

export function pillLabel(type: PillType) {
  switch (type) {
    case "your-post": return "YOUR POST";
    case "post": return "POST";
    case "reply": return "REPLY";
    case "invisible": return "INVISIBLE";
  }
}

export function basePillStyle(type: PillType, align: PillAlign, slotIndex: number): React.CSSProperties {
  const isInvisible = type === "invisible";
  const isYourPost = type === "your-post";
  const color = isInvisible ? RED : GREEN;
  const offset = align === "right" ? INDENT : -INDENT;

  return {
    position: "absolute",
    top: slotIndex * SLOT_H,
    left: `calc(50% - ${PILL_W / 2}px + ${offset}px)`,
    width: PILL_W,
    height: PILL_H,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9999,
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
    lineHeight: 1.3,
    boxSizing: "border-box",
    borderWidth: BORDER_W,
    ...(isYourPost
      ? { background: GREEN, color: CANON.cream, borderStyle: "solid" as const, borderColor: "transparent" }
      : { background: "transparent", color, borderStyle: "dashed" as const, borderColor: color }),
  };
}

// ── Panel graphic ─────────────────────────────────────────────────────────

function PanelGraphic({ panelIndex }: { panelIndex: number }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (panelIndex === 0) return;
    setPhase(0);
    const t1 = setTimeout(() => setPhase(1), PHASE_DELAY);
    // Panel 2: phase 2 triggers red flicker after slide completes
    const t2 = panelIndex === 1
      ? setTimeout(() => setPhase(2), PHASE_DELAY + SLIDE_DURATION * 1000)
      : undefined;
    return () => { clearTimeout(t1); if (t2) clearTimeout(t2); };
  }, [panelIndex]);

  const slots = panelSlots[panelIndex];
  const prevSlots = panelIndex > 0 ? panelSlots[panelIndex - 1] : null;

  const box: React.CSSProperties = {
    flex: 1,
    borderRadius: 16,
    background: BOX_BG,
    padding: "20px 16px",
    position: "relative",
    overflow: "hidden",
  };

  const inner: React.CSSProperties = {
    position: "relative",
    height: NUM_SLOTS * SLOT_H,
  };

  // ── Panel 1: staggered rise ──────────────────────────────────────────
  if (panelIndex === 0) {
    let visIdx = 0;
    return (
      <div style={box}>
        <div style={inner}>
          {slots.map((slot, i) => {
            if (!slot) return null;
            const delay = visIdx * VISIBLE_STAGGER;
            visIdx++;
            return (
              <div
                key={i}
                style={{
                  ...basePillStyle(slot.type, slot.align, i),
                  opacity: 0,
                  animation: `hiw-rise ${VISIBLE_DURATION}s ease ${delay}s forwards`,
                }}
              >
                {pillLabel(slot.type)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Panel 2: slide greens + flicker reds ────────────────────────────
  if (panelIndex === 1) {
    return (
      <div style={box}>
        <div style={inner}>
          {slots.map((slot, i) => {
            if (!slot) return null;

            // YOUR POST — always visible, no animation
            if (slot.type === "your-post") {
              return (
                <div key={i} style={{ ...basePillStyle(slot.type, slot.align, i), opacity: 1 }}>
                  {pillLabel(slot.type)}
                </div>
              );
            }

            // Green pill that slides from panel 1 position
            const slideFrom = panel2SlideMap[i];
            if (slideFrom !== undefined) {
              const slideY = phase < 1 ? (slideFrom - i) * SLOT_H : 0;
              return (
                <div
                  key={i}
                  style={{
                    ...basePillStyle(slot.type, slot.align, i),
                    opacity: 1,
                    transform: `translateY(${slideY}px)`,
                    transition: `transform ${SLIDE_DURATION}s ease`,
                  }}
                >
                  {pillLabel(slot.type)}
                </div>
              );
            }

            // Red invisible pill — hidden until phase 2 (after slide completes)
            return (
              <div
                key={i}
                style={{
                  ...basePillStyle(slot.type, slot.align, i),
                  ...(phase < 2
                    ? { opacity: 0 }
                    : { opacity: 0, animation: `hiw-flicker-red ${INVISIBLE_DURATION}s ease forwards` }),
                }}
              >
                {pillLabel(slot.type)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Panels 3-4: morph reds → greens ─────────────────────────────────
  return (
    <div style={box}>
      <div style={inner}>
        {slots.map((slot, i) => {
          if (!slot) return null;
          const prev = prevSlots?.[i];

          // Was invisible in previous panel, now visible → morphing pill
          const isMorphing =
            prev?.type === "invisible" &&
            slot.type !== "invisible" &&
            slot.type !== "your-post";

          if (isMorphing) {
            // Crossfade: old red pill fades out, new green pill fades in
            const prevAlign = prev?.align ?? slot.align;
            const prevOffset = prevAlign === "right" ? INDENT : -INDENT;
            const newOffset = slot.align === "right" ? INDENT : -INDENT;

            return (
              <React.Fragment key={i}>
                {/* Outgoing red pill */}
                <div
                  style={{
                    ...basePillStyle("invisible", prevAlign, i),
                    left: `calc(50% - ${PILL_W / 2}px + ${prevOffset}px)`,
                    opacity: phase === 0 ? 0.74 : 0,
                    transition: `opacity ${MORPH_DURATION}s ease`,
                    pointerEvents: "none",
                  }}
                >
                  {pillLabel("invisible")}
                </div>
                {/* Incoming green pill */}
                <div
                  style={{
                    ...basePillStyle(slot.type, slot.align, i),
                    left: `calc(50% - ${PILL_W / 2}px + ${newOffset}px)`,
                    opacity: phase === 0 ? 0 : 1,
                    transition: `opacity ${MORPH_DURATION}s ease`,
                  }}
                >
                  {pillLabel(slot.type)}
                </div>
              </React.Fragment>
            );
          }

          // Non-morphing pill — just show at final state
          const opacity = slot.type === "invisible" ? 0.74 : 1;
          return (
            <div key={i} style={{ ...basePillStyle(slot.type, slot.align, i), opacity }}>
              {pillLabel(slot.type)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

const PANEL_HEIGHT = 520;
const TOTAL_STEPS = 5;

export default function HowItWorksV2({ onClose, onSignup }: { onClose?: () => void; onSignup?: () => void } = {}) {
  injectKeyframes();

  const [step, setStep] = useState(0);
  // Incremented on every click of the panel-5 logo to force SidebarLogo to
  // remount and replay its block-scatter animation. The component runs its
  // animation once in a mount-effect, so remounting via `key` is the
  // simplest way to reset it without touching its internals.
  const [logoResetKey, setLogoResetKey] = useState(0);
  const navigate = useNavigate();
  const isJoinStep = step === TOTAL_STEPS - 1;
  const isLastPanel = step === panelSlots.length - 1;

  const handleClose = onClose ?? (() => navigate("/"));
  const handleSignup = onSignup ?? (() => navigate("/?signup"));

  const panelKey = `panel-${step}`;

  return (
    <div
      style={{
        minHeight: onClose ? undefined : "100vh",
        background: PAGE_BG,
        fontFamily: '"Inter",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        color: CANON.cream,
        padding: "24px 16px 40px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* Close button */}
      <div style={{ width: "100%", maxWidth: 860, marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
        <button className="close-x" onClick={handleClose}>
          <X size={14} />
        </button>
      </div>

      {/* Panel area */}
      <div style={{ width: "100%", maxWidth: 860, height: PANEL_HEIGHT }}>
        {isJoinStep ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 32,
            }}
          >
            {/* Dynamic logo — clickable, click replays block animation.
               key={logoResetKey} forces a remount of SidebarLogo so its
               mount-effect reruns and re-scatters + resettles the blocks. */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Replay logo animation"
              onClick={() => setLogoResetKey(k => k + 1)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLogoResetKey(k => k + 1); } }}
              style={{ cursor: "pointer", display: "inline-block" }}
            >
              <SidebarLogo key={logoResetKey} scale={0.9} />
            </div>
            <button
              onClick={handleSignup}
              style={{
                background: CANON.cream,
                color: PAGE_BG,
                border: "none",
                borderRadius: 9999,
                padding: "16px 48px",
                fontSize: 20,
                fontWeight: 800,
                cursor: "pointer",
                letterSpacing: "0.02em",
              }}
            >
              Join Sidebar
            </button>
          </div>
        ) : (
          <div key={panelKey} style={{ display: "flex", gap: 0, height: "100%" }}>
            {/* Left — caption */}
            <div
              style={{
                flex: "0 0 42%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                padding: "24px 48px 24px 32px",
              }}
            >
              {panelTitles[step] && (
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 900,
                    lineHeight: 1.2,
                    color: CANON.cream,
                    marginBottom: 32,
                    whiteSpace: "pre-line",
                  }}
                >
                  {panelTitles[step]}
                </div>
              )}
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  lineHeight: 1.6,
                  color: CANON.cream,
                  whiteSpace: "pre-line",
                }}
              >
                {panelCaptions[step]}
              </div>
            </div>

            {/* Right — pill graphic */}
            <div style={{ flex: 1, display: "flex" }}>
              <PanelGraphic panelIndex={step} />
            </div>
          </div>
        )}
      </div>

      {/* Navigation — fixed-width sides keep dots centered */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 16 }}>
        {/* Left side — fixed width */}
        <div style={{ width: 36, flexShrink: 0 }}>
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{
              width: 36, height: 36,
              background: "transparent",
              border: "2px solid var(--canon-cream,#fef8ea)",
              borderRadius: "50%",
              padding: 0,
              cursor: step === 0 ? "default" : "pointer",
              opacity: step === 0 ? 0.3 : 1,
              color: CANON.cream,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ArrowLeft size={16} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              onClick={() => setStep(i)}
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: i === step ? CANON.cream : "rgba(253,248,236,0.35)",
                cursor: "pointer",
              }}
            />
          ))}
        </div>

        {/* Right side — fixed width, "got it" positioned absolutely */}
        <div style={{ width: 36, flexShrink: 0, position: "relative" }}>
          {isJoinStep ? null : isLastPanel ? (
            <button
              onClick={() => setStep(s => s + 1)}
              style={{
                position: "absolute",
                left: 0,
                top: "50%",
                transform: "translateY(-50%)",
                background: "rgba(253,248,236,0.92)",
                border: "2px solid var(--canon-cream,#fef8ea)",
                borderRadius: 9999,
                padding: "8px 18px",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600,
                color: PAGE_BG,
                whiteSpace: "nowrap",
              }}
            >
              got it
            </button>
          ) : (
            <button
              onClick={() => setStep(s => s + 1)}
              style={{
                width: 36, height: 36,
                background: "transparent",
                border: "2px solid var(--canon-cream,#fef8ea)",
                borderRadius: "50%",
                padding: 0,
                cursor: "pointer",
                color: CANON.cream,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.45, fontWeight: 600 }}>
        {step + 1} / {TOTAL_STEPS}
      </div>
    </div>
  );
}
