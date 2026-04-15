import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, ArrowUpLeft } from "lucide-react";

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
  showArrow?: boolean;
};

// ── 5 panels matching the PDF ──────────────────────────────────────────────

const panels: Panel[] = [
  {
    yourEp: 1,
    friendEp: 0,
    posts: [
      { label: "YOUR post - ep 1", owner: "you", visible: [true, false] },
    ],
    caption:
      "You just watched the first episode of a show. You loved it and invited a friend to watch with you. You\u2019ve already made a post about the show. But since your friend hasn\u2019t started yet, they don\u2019t see your post yet.",
    showArrow: true,
  },
  {
    yourEp: 2,
    friendEp: 4,
    posts: [
      { label: "YOUR post - ep 1", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 2", owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 4", owner: "friend", visible: [false, true] },
      { label: "YOUR post - ep 2", owner: "you", visible: [true, true] },
    ],
    caption:
      "Later, your friend has written more and has watched ahead. But even though one of their posts was written before your second one, you don\u2019t see it until you catch up.",
  },
  {
    yourEp: 7,
    friendEp: 5,
    posts: [
      { label: "YOUR post - ep 1", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 3", owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 4", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 2", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 4", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 6", owner: "you", visible: [true, false] },
      { label: "FRIEND post - ep 5", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 7", owner: "you", visible: [true, false] },
    ],
    caption:
      "This filtering is applied across the entire site, to: posts, responses, public posts.",
  },
  {
    yourEp: 12,
    friendEp: 8,
    posts: [
      { label: "YOUR post - ep 8", owner: "you", visible: [true, false] },
      { label: "FRIEND post - ep 6", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 9", owner: "you", visible: [true, false] },
      { label: "FRIEND post - ep 7", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 12", owner: "you", visible: [true, false] },
      { label: "FRIEND post - ep 8", owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 10", owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 13", owner: "you", visible: [true, false] },
    ],
    caption: "Nobody has to hold back. Nobody gets spoiled.",
  },
  {
    yourEp: 15,
    friendEp: 19,
    posts: [
      { label: "YOUR post - ep 13", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 14", owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 15", owner: "friend", visible: [false, true] },
      { label: "FRIEND post - ep 16", owner: "friend", visible: [false, true] },
      { label: "FRIEND post - ep 18", owner: "friend", visible: [false, true] },
      { label: "YOUR post - ep 14", owner: "you", visible: [true, true] },
      { label: "YOUR post - ep 15", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 19", owner: "friend", visible: [false, true] },
    ],
    caption: "Invite a friend. Don\u2019t stop talking.",
  },
];

// ── Colors ──────────────────────────────────────────────────────────────────
// Green page background matching the site. White-on-green text.
// "You" pills: white with green text. "Friend" pills: a warm accent.
const PAGE_BG = "#7abd8e";
const PANEL_BG = "rgba(255,255,255,0.92)";
const TEXT_ON_PANEL = "#4a7a5a";
const MUTED_ON_PANEL = "rgba(74,122,90,0.55)";
const YOU_COLOR = "#375eb8";
const FRIEND_COLOR = "#dea838";
const DIVIDER = "rgba(74,122,90,0.15)";

// ── Pill ────────────────────────────────────────────────────────────────────

function Pill({ label, owner, isVisible }: { label: string; owner: "you" | "friend"; isVisible: boolean }) {
  const color = owner === "you" ? YOU_COLOR : FRIEND_COLOR;
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
        ...(isVisible
          ? { background: color, color: "#fff", border: "2px solid transparent" }
          : { background: "transparent", color: color, border: `2px dashed ${color}`, opacity: 0.4 }),
      }}
    >
      {label}
    </div>
  );
}

// ── Panel content ──────────────────────────────────────────────────────────

const PANEL_HEIGHT = 460;

function PanelContent({ panel }: { panel: Panel }) {
  const firstInvisFriend = panel.showArrow
    ? panel.posts.findIndex(p => !p.visible[1])
    : -1;

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Your view */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 6px" }}>
        <div style={{ fontWeight: 900, fontSize: 22, color: TEXT_ON_PANEL }}>your view</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: MUTED_ON_PANEL, marginBottom: 14 }}>
          episodes watched: {panel.yourEp}
        </div>
        {panel.posts.map((p, i) => (
          <div key={`y-${i}`} style={{ marginBottom: 7 }}>
            <Pill label={p.label} owner={p.owner} isVisible={p.visible[0]} />
          </div>
        ))}
      </div>

      {/* Divider */}
      <div style={{ width: 1, background: DIVIDER, flexShrink: 0 }} />

      {/* Friend's view */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 6px" }}>
        <div style={{ fontWeight: 900, fontSize: 22, color: TEXT_ON_PANEL }}>friend&rsquo;s view</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: MUTED_ON_PANEL, marginBottom: 14 }}>
          episodes watched: {panel.friendEp}
        </div>
        {panel.posts.map((p, i) => (
          <div key={`f-${i}`} style={{ marginBottom: 7, position: "relative" }}>
            <Pill label={p.label} owner={p.owner} isVisible={p.visible[1]} />
            {i === firstInvisFriend && (
              <div
                style={{
                  position: "absolute",
                  right: -90,
                  top: -6,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  transform: "rotate(-20deg)",
                  color: TEXT_ON_PANEL,
                  fontSize: 11,
                  fontWeight: 700,
                  fontStyle: "italic",
                  whiteSpace: "nowrap",
                  opacity: 0.7,
                  pointerEvents: "none",
                }}
              >
                <ArrowUpLeft size={14} color={TEXT_ON_PANEL} />
                invisible post
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function HowItWorks() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const isLast = step === panels.length - 1;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: PAGE_BG,
        fontFamily: '"Inter","Nunito",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        color: "#fff",
        padding: "32px 16px 80px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* Back link */}
      <div style={{ width: "100%", maxWidth: 780, marginBottom: 20 }}>
        <button
          onClick={() => navigate("/")}
          style={{
            background: "transparent",
            border: "2px solid #fff",
            borderRadius: 9999,
            padding: "6px 14px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <ArrowLeft size={14} /> back to Sidebar
        </button>
      </div>

      {/* Title */}
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 24, textAlign: "center", color: "#fff" }}>
        How does the no-spoiler mechanic work?
      </div>

      {/* Fixed-size panel */}
      <div
        style={{
          width: "100%",
          maxWidth: 780,
          height: PANEL_HEIGHT,
          borderRadius: 16,
          background: PANEL_BG,
          padding: 20,
          boxSizing: "border-box",
          overflow: "auto",
        }}
      >
        <PanelContent panel={panels[step]} />
      </div>

      {/* Caption */}
      <div
        style={{
          maxWidth: 580,
          marginTop: 20,
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1.55,
          textAlign: "center",
          color: "#fff",
          opacity: 0.9,
        }}
      >
        {panels[step].caption}
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 28 }}>
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
          {panels.map((_, i) => (
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

        <button
          onClick={() => {
            if (isLast) navigate("/");
            else setStep(s => s + 1);
          }}
          style={{
            background: isLast ? "rgba(255,255,255,0.92)" : "transparent",
            border: "2px solid #fff",
            borderRadius: 9999,
            padding: "8px 18px",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600,
            color: isLast ? PAGE_BG : "#fff",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {isLast ? "got it" : "next"} <ArrowRight size={14} />
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.45, fontWeight: 600 }}>
        {step + 1} / {panels.length}
      </div>
    </div>
  );
}
