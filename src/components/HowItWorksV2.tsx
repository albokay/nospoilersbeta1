import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type Post = {
  label: string;
  owner: "you" | "friend";
  visible: [boolean, boolean];
};

type Panel = {
  yourEp: number;
  friendEp: number;
  posts: Post[];
  caption: string;
};

// ── 4 panels (descending / newest first) ───────────────────────────────────

const panels: Panel[] = [
  {
    yourEp: 1,
    friendEp: 0,
    posts: [
      { label: "YOUR post - ep 1", owner: "you", visible: [true, false] },
    ],
    caption:
      "You just watched the first episode of a show. You loved it and invited a friend to watch with you. You\u2019ve already made a post about the show. But since your friend hasn\u2019t started yet, they don\u2019t see your post yet.",
  },
  {
    yourEp: 2,
    friendEp: 4,
    posts: [
      { label: "YOUR post - ep 2", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 4", owner: "friend", visible: [false, true] },
      { label: "FRIEND post - ep 2", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 1", owner: "you", visible: [true, true] },
    ],
    caption:
      "Later, your friend has written more and has watched ahead. But even though one of their posts was written before your second one, you don\u2019t see it until you catch up.",
  },
  {
    yourEp: 7,
    friendEp: 5,
    posts: [
      { label: "YOUR post - ep 7", owner: "you", visible: [true, false] },
      { label: "FRIEND post - ep 5", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 6", owner: "you", visible: [true, false] },
      { label: "FRIEND post - ep 4", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 2", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 4", owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 3", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 1", owner: "you", visible: [true, true] },
    ],
    caption:
      "This filtering is applied across the entire site, to: posts, responses, public posts.",
  },
  {
    yourEp: 8,
    friendEp: 9,
    posts: [
      { label: "FRIEND post - ep 9", owner: "friend", visible: [false, true] },
      { label: "YOUR post - ep 8", owner: "you", visible: [true, true] },
      { label: "YOUR post - ep 7", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 5", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 6", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 4", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 2", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 4", owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 3", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 1", owner: "you", visible: [true, true] },
    ],
    caption: "Nobody has to hold back. Nobody gets spoiled.",
  },
];

// ── Colors ──────────────────────────────────────────────────────────────────

const PAGE_BG = "#7abd8e";
const BOX_BG = "rgba(255,255,255,0.92)";
const YOU_THEME = "#375eb8";
const FRIEND_THEME = "#dea838";
const YOU_COLOR = "#375eb8";
const FRIEND_COLOR = "#dea838";

// ── Animation timing ────────────────────────────────────────────────────────

const VISIBLE_STAGGER = 0.15;   // seconds between each visible pill
const VISIBLE_DURATION = 0.5;   // seconds for visible pill to animate in
const INVISIBLE_PAUSE = 0;      // seconds to wait after last visible pill finishes
const INVISIBLE_DURATION = 2;   // seconds for invisible pill flicker

// ── CSS keyframes (injected once) ──────────────────────────────────────────

const KEYFRAMES = `
@keyframes hiw-rise {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes hiw-flicker-blue {
  0%   { opacity: 0; }
  33%  { opacity: 0.44; }
  66%  { opacity: 0.20; }
  100% { opacity: 0.60; }
}
@keyframes hiw-flicker-yellow {
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

function Pill({
  label,
  owner,
  isVisible,
  animDelay,
  isInvisiblePill,
}: {
  label: string;
  owner: "you" | "friend";
  isVisible: boolean;
  animDelay: number;
  isInvisiblePill: boolean;
}) {
  const color = owner === "you" ? YOU_COLOR : FRIEND_COLOR;
  const animName = isInvisiblePill
    ? (owner === "you" ? "hiw-flicker-blue" : "hiw-flicker-yellow")
    : "hiw-rise";
  const animDur = isInvisiblePill ? INVISIBLE_DURATION : VISIBLE_DURATION;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 180,
        padding: "7px 0",
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
        lineHeight: 1.3,
        opacity: 0,
        animation: `${animName} ${animDur}s ease forwards`,
        animationDelay: `${animDelay}s`,
        ...(isVisible
          ? { background: color, color: "#fff", border: "2px solid transparent" }
          : { background: "transparent", color: color, border: `2px dashed ${color}` }),
      }}
    >
      {isVisible ? label : "invisible post"}
    </div>
  );
}

// ── View box ───────────────────────────────────────────────────────────────

function ViewBox({
  title,
  epCount,
  posts,
  side,
  themeColor,
  invisibleStart,
}: {
  title: string;
  epCount: number;
  posts: Post[];
  side: 0 | 1;
  themeColor: string;
  invisibleStart: number;
}) {
  // Track stagger index for visible pills on this side
  let visIndex = 0;

  return (
    <div
      style={{
        flex: 1,
        borderRadius: 16,
        background: BOX_BG,
        padding: "16px 12px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        overflow: "auto",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: themeColor }}>{title}</div>
      <div style={{ fontWeight: 900, fontSize: 20, color: themeColor, marginBottom: 14 }}>
        episodes watched: {epCount}
      </div>
      {posts.map((p, i) => {
        const isVis = p.visible[side];
        let delay: number;
        if (isVis) {
          delay = visIndex * VISIBLE_STAGGER;
          visIndex++;
        } else {
          delay = invisibleStart;
        }
        return (
          <div key={i} style={{ marginBottom: 7 }}>
            <Pill
              label={p.label}
              owner={p.owner}
              isVisible={isVis}
              animDelay={delay}
              isInvisiblePill={!isVis}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Panel content ──────────────────────────────────────────────────────────

const PANEL_HEIGHT = 460;
const CAPTION_HEIGHT = 80;

function PanelContent({ panel, panelIndex }: { panel: Panel; panelIndex: number }) {
  // Count max visible pills across both sides to calculate invisible start time
  const yourVisCount = panel.posts.filter(p => p.visible[0]).length;
  const friendVisCount = panel.posts.filter(p => p.visible[1]).length;
  const maxVisCount = Math.max(yourVisCount, friendVisCount);
  // Panel 0 gets a 1s pause before invisible pills; others start immediately
  const extraPause = panelIndex === 0 ? 1 : 0;
  const invisibleStart = (maxVisCount - 1) * VISIBLE_STAGGER + VISIBLE_DURATION + INVISIBLE_PAUSE + extraPause;

  return (
    <div style={{ display: "flex", gap: 12, height: "100%" }}>
      <ViewBox title="your view" epCount={panel.yourEp} posts={panel.posts} side={0} themeColor={YOU_THEME} invisibleStart={invisibleStart} />
      <ViewBox title="friend's view" epCount={panel.friendEp} posts={panel.posts} side={1} themeColor={FRIEND_THEME} invisibleStart={invisibleStart} />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

const TOTAL_STEPS = 5; // 4 animated panels + 1 join screen

export default function HowItWorksV2({ onClose, onSignup }: { onClose?: () => void; onSignup?: () => void } = {}) {
  injectKeyframes();

  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const isJoinStep = step === TOTAL_STEPS - 1;
  const isLastPanel = step === panels.length - 1; // panel 4 (index 3)

  const handleClose = onClose ?? (() => navigate("/"));
  const handleSignup = onSignup ?? (() => navigate("/?signup"));

  // Key forces remount so animations replay on step change
  const panelKey = `panel-${step}`;

  return (
    <div
      style={{
        minHeight: onClose ? undefined : "100vh",
        background: PAGE_BG,
        fontFamily: '"Inter","Nunito",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        color: "#fff",
        padding: "32px 16px 80px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* Close button — top right */}
      <div style={{ width: "100%", maxWidth: 780, marginBottom: 20, display: "flex", justifyContent: "flex-end" }}>
        <button
          className="close-x"
          onClick={handleClose}
        >
          <X size={14} />
        </button>
      </div>

      {/* Title */}
      {!isJoinStep && (
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 24, textAlign: "center", color: "#fff" }}>
          How does the no-spoiler mechanic work?
        </div>
      )}

      {/* Panel area — fixed height */}
      <div style={{ width: "100%", maxWidth: 780, height: PANEL_HEIGHT }}>
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
          /* ── Animated panel ── */
          <div key={panelKey} style={{ height: "100%" }}>
            <PanelContent panel={panels[step]} panelIndex={step} />
          </div>
        )}
      </div>

      {/* Caption — fixed height */}
      <div
        style={{
          height: CAPTION_HEIGHT,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          maxWidth: 580,
          marginTop: 20,
        }}
      >
        {!isJoinStep && (
          <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.55, textAlign: "center", color: "#fff", opacity: 0.9 }}>
            {panels[step].caption}
          </div>
        )}
      </div>

      {/* Navigation — always visible */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 12 }}>
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
          /* invisible spacer to keep dots centered */
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
