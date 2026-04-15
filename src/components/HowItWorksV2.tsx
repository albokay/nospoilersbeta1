import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type PillType = "your-post" | "post" | "reply" | "invisible";
type PillAlign = "left" | "right";

type PillData = { type: PillType; align: PillAlign };

type Panel = {
  title?: string;
  caption: React.ReactNode;
  pills: PillData[];
};

// ── 4 content panels ──────────────────────────────────────────────────────
// Pill alignment matches PDF: posts left, replies right, invisible inherits

const panels: Panel[] = [
  {
    title: "HOW DO THE NO-SPOILER\nMECHANICS WORK?",
    caption: (
      <>
        Your friends have been watching a new show and invited you to their Sidebar room.
        {"\n\n"}
        You watch the first episode and log in. You read a handful of posts and then make your own post about your first impressions.
        {"\n\n"}
        <em>But in reality{"\u2026"}</em>
      </>
    ),
    pills: [
      { type: "your-post", align: "left" },
      { type: "post",      align: "left" },
      { type: "reply",     align: "right" },
      { type: "post",      align: "left" },
      { type: "reply",     align: "right" },
      { type: "reply",     align: "right" },
      { type: "post",      align: "left" },
    ],
  },
  {
    caption:
      "There is a lot more activity in the room because the show has 4 episodes available and your friends have been talking.\n\nFor now, you can\u2019t see anything they wrote after having watched episode 2.\n\nSoon enough your post even gets replies from friends who\u2019ve watched more than you.",
    pills: [
      { type: "invisible", align: "left" },
      { type: "invisible", align: "right" },
      { type: "your-post", align: "left" },
      { type: "invisible", align: "left" },
      { type: "invisible", align: "right" },
      { type: "invisible", align: "left" },
      { type: "post",      align: "left" },
      { type: "reply",     align: "right" },
      { type: "invisible", align: "left" },
      { type: "reply",     align: "right" },
      { type: "invisible", align: "left" },
      { type: "post",      align: "left" },
    ],
  },
  {
    caption:
      "A few days later you watch episode 2 and more activity is revealed to you. When you catch up, you\u2019ll be able to read everything.",
    pills: [
      { type: "invisible", align: "left" },
      { type: "invisible", align: "right" },
      { type: "your-post", align: "left" },
      { type: "reply",     align: "right" },
      { type: "reply",     align: "right" },
      { type: "post",      align: "left" },
      { type: "post",      align: "left" },
      { type: "reply",     align: "right" },
      { type: "reply",     align: "right" },
      { type: "reply",     align: "right" },
      { type: "invisible", align: "left" },
      { type: "post",      align: "left" },
    ],
  },
  {
    caption: (
      <>
        No one ever writes {"\u201C"}I can{"\u2019"}t wait for you to watch{"\u2026\u201D"} or censors their excitement in any way.
        {"\n\n"}
        You all write as if you{"\u2019"}ve JUST watched an episode together {"\u2014"} and the site makes that experience real.
      </>
    ),
    pills: [
      { type: "post",      align: "left" },
      { type: "reply",     align: "right" },
      { type: "your-post", align: "left" },
      { type: "reply",     align: "right" },
      { type: "reply",     align: "right" },
      { type: "post",      align: "left" },
      { type: "post",      align: "left" },
      { type: "reply",     align: "right" },
      { type: "reply",     align: "right" },
      { type: "reply",     align: "right" },
      { type: "post",      align: "left" },
      { type: "post",      align: "left" },
    ],
  },
];

// ── Colors ──────────────────────────────────────────────────────────────────

const PAGE_BG = "#7abd8e";
const BOX_BG = "rgba(255,255,255,0.92)";
const GREEN = "#7abd8e";
const RED = "#f45028";
const BORDER_W = 3;

// ── Animation timing ────────────────────────────────────────────────────────

const VISIBLE_STAGGER = 0.15;
const VISIBLE_DURATION = 0.5;
const INVISIBLE_DURATION = 2;

// ── CSS keyframes (injected once) ──────────────────────────────────────────

const KEYFRAMES = `
@keyframes hiw-rise {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes hiw-flicker-green {
  0%   { opacity: 0; }
  33%  { opacity: 0.44; }
  66%  { opacity: 0.20; }
  100% { opacity: 0.60; }
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
  const style = document.createElement("style");
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

// ── Pill ────────────────────────────────────────────────────────────────────

const PILL_W = 170;
const INDENT = 24;

function Pill({
  type,
  align,
  animDelay,
}: {
  type: PillType;
  align: PillAlign;
  animDelay: number;
}) {
  const isInvisible = type === "invisible";
  const isYourPost = type === "your-post";
  const color = isInvisible ? RED : GREEN;
  const label = isYourPost
    ? "YOUR POST"
    : isInvisible
    ? "INVISIBLE"
    : type === "post"
    ? "POST"
    : "REPLY";

  const animName = isInvisible ? "hiw-flicker-red" : "hiw-rise";
  const animDur = isInvisible ? INVISIBLE_DURATION : VISIBLE_DURATION;

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        paddingLeft: align === "right" ? INDENT : 0,
        paddingRight: align === "left" ? INDENT : 0,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: PILL_W,
          padding: "7px 0",
          borderRadius: 9999,
          fontSize: 12,
          fontWeight: 700,
          whiteSpace: "nowrap",
          lineHeight: 1.3,
          opacity: 0,
          animation: `${animName} ${animDur}s ease forwards`,
          animationDelay: `${animDelay}s`,
          ...(isYourPost
            ? { background: GREEN, color: "#fff", border: `${BORDER_W}px solid transparent` }
            : { background: "transparent", color, border: `${BORDER_W}px dashed ${color}` }),
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ── Panel graphic (right side) ────────────────────────────────────────────

function PanelGraphic({ panel, panelIndex }: { panel: Panel; panelIndex: number }) {
  const visiblePills = panel.pills.filter(p => p.type !== "invisible");
  const visCount = visiblePills.length;
  const extraPause = panelIndex === 0 ? 1 : 0;
  const invisibleStart = (visCount - 1) * VISIBLE_STAGGER + VISIBLE_DURATION + extraPause;

  let visIndex = 0;

  return (
    <div
      style={{
        flex: 1,
        borderRadius: 16,
        background: BOX_BG,
        padding: "20px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        overflowY: "auto",
      }}
    >
      {panel.pills.map((p, i) => {
        const isInvis = p.type === "invisible";
        let delay: number;
        if (!isInvis) {
          delay = visIndex * VISIBLE_STAGGER;
          visIndex++;
        } else {
          delay = invisibleStart;
        }
        return (
          <div key={i} style={{ marginBottom: 6, width: "100%" }}>
            <Pill type={p.type} align={p.align} animDelay={delay} />
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

const PANEL_HEIGHT = 520;
const TOTAL_STEPS = 5;

export default function HowItWorksV2({ onClose, onSignup }: { onClose?: () => void; onSignup?: () => void } = {}) {
  injectKeyframes();

  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const isJoinStep = step === TOTAL_STEPS - 1;
  const isLastPanel = step === panels.length - 1;

  const handleClose = onClose ?? (() => navigate("/"));
  const handleSignup = onSignup ?? (() => navigate("/?signup"));

  const panelKey = `panel-${step}`;

  return (
    <div
      style={{
        minHeight: onClose ? undefined : "100vh",
        background: PAGE_BG,
        fontFamily: '"Inter","Nunito",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        color: "#fff",
        padding: "24px 16px 40px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* Close button — top right */}
      <div style={{ width: "100%", maxWidth: 860, marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
        <button className="close-x" onClick={handleClose}>
          <X size={14} />
        </button>
      </div>

      {/* Panel area — fixed height, split layout */}
      <div style={{ width: "100%", maxWidth: 860, height: PANEL_HEIGHT }}>
        {isJoinStep ? (
          /* ── Join screen (panel 5) ── */
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 24,
            }}
          >
            <button
              onClick={handleSignup}
              style={{
                background: "#fff",
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
          /* ── Split panel: caption left, graphic right ── */
          <div key={panelKey} style={{ display: "flex", gap: 0, height: "100%" }}>
            {/* Left — green caption area */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                padding: "24px 28px 24px 12px",
              }}
            >
              {panels[step].title && (
                <div style={{
                  fontSize: 24,
                  fontWeight: 900,
                  lineHeight: 1.2,
                  color: "#fff",
                  marginBottom: 32,
                  whiteSpace: "pre-line",
                }}>
                  {panels[step].title}
                </div>
              )}
              <div style={{
                fontSize: 15,
                fontWeight: 700,
                lineHeight: 1.6,
                color: "#fff",
                whiteSpace: "pre-line",
              }}>
                {panels[step].caption}
              </div>
            </div>

            {/* Right — pill graphic */}
            <div style={{ flex: 1, display: "flex" }}>
              <PanelGraphic panel={panels[step]} panelIndex={step} />
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 16 }}>
        <button
          onClick={() => setStep(s => Math.max(0, s - 1))}
          disabled={step === 0}
          style={{
            background: "transparent",
            border: "2px solid #fff",
            borderRadius: 9999,
            padding: "8px 18px",
            cursor: step === 0 ? "default" : "pointer",
            opacity: step === 0 ? 0.3 : 1,
            fontSize: 14,
            fontWeight: 600,
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <ArrowLeft size={14} /> back
        </button>

        <div style={{ display: "flex", gap: 8 }}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              onClick={() => setStep(i)}
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: i === step ? "#fff" : "rgba(255,255,255,0.35)",
                cursor: "pointer",
              }}
            />
          ))}
        </div>

        {isJoinStep ? (
          <div style={{ width: 105 }} />
        ) : (
          <button
            onClick={() => setStep(s => s + 1)}
            style={{
              background: isLastPanel ? "rgba(255,255,255,0.92)" : "transparent",
              border: "2px solid #fff",
              borderRadius: 9999,
              padding: "8px 18px",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              color: isLastPanel ? PAGE_BG : "#fff",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isLastPanel ? "got it" : "next"} <ArrowRight size={14} />
          </button>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.45, fontWeight: 600 }}>
        {step + 1} / {TOTAL_STEPS}
      </div>
    </div>
  );
}
