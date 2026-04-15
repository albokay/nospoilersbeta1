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
  narrative?: string;
  callouts?: { text: string; afterIndex: number }[];
  showArrow?: boolean;
};

// ── 5 panels matching the PDF exactly ──────────────────────────────────────

const panels: Panel[] = [
  // Panel 1
  {
    yourEp: 1,
    friendEp: 0,
    posts: [
      { label: "YOUR post - ep 1", owner: "you", visible: [true, false] },
    ],
    narrative:
      "You just watched the first episode of a show. You loved it and invited a friend to watch with you. You\u2019ve already made a post about the show. But since your friend hasn\u2019t started yet, they don\u2019t see your post yet.",
    showArrow: true,
  },

  // Panel 2
  {
    yourEp: 2,
    friendEp: 4,
    posts: [
      { label: "YOUR post - ep 1", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 2", owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 4", owner: "friend", visible: [false, true] },
      { label: "YOUR post - ep 2", owner: "you", visible: [true, true] },
    ],
    narrative:
      "Later, your friend has written more and has watched ahead. But even though one of their posts was written before your second one, you don\u2019t see it until you catch up.",
  },

  // Panel 3 — first half of the long feed
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
    callouts: [
      { text: "This filtering is applied across the entire site, to: posts, responses, public posts.", afterIndex: 7 },
    ],
  },

  // Panel 4 — second half
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
    callouts: [
      { text: "Nobody has to hold back.", afterIndex: 2 },
      { text: "Nobody gets spoiled.", afterIndex: 6 },
    ],
  },

  // Panel 5 — finale with CTAs
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
    callouts: [
      { text: "Invite a friend.", afterIndex: 1 },
      { text: "Don\u2019t stop talking.", afterIndex: 5 },
    ],
  },
];

// ── Pill ────────────────────────────────────────────────────────────────────

function Pill({ label, owner, isVisible }: { label: string; owner: "you" | "friend"; isVisible: boolean }) {
  const color = owner === "you" ? "#375eb8" : "#dea838";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px 20px",
        borderRadius: 9999,
        fontSize: 13,
        fontWeight: 700,
        whiteSpace: "nowrap",
        lineHeight: 1.3,
        ...(isVisible
          ? { background: color, color: "#fff", border: "2px solid transparent" }
          : { background: "transparent", color: color, border: `2px dashed ${color}`, opacity: 0.45 }),
      }}
    >
      {label}
    </div>
  );
}

// ── Single panel content ───────────────────────────────────────────────────

function PanelContent({ panel }: { panel: Panel }) {
  const firstInvisFriend = panel.showArrow
    ? panel.posts.findIndex(p => !p.visible[1])
    : -1;

  // Build callout lookup: afterIndex → text
  const calloutMap: Record<number, string> = {};
  for (const c of panel.callouts ?? []) calloutMap[c.afterIndex] = c.text;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Split screen */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Your view */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 8px" }}>
          <div style={{ fontWeight: 900, fontSize: 26, color: "#1a2c3a" }}>your view</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2c3a", opacity: 0.6, marginBottom: 16 }}>
            episodes watched: {panel.yourEp}
          </div>
          {panel.posts.map((p, i) => (
            <div key={`y-${i}`} style={{ marginBottom: 8 }}>
              <Pill label={p.label} owner={p.owner} isVisible={p.visible[0]} />
            </div>
          ))}
        </div>

        {/* Center divider with callouts */}
        <div style={{ width: 2, background: "rgba(26,44,58,0.15)", flexShrink: 0, position: "relative" }}>
          {(panel.callouts ?? []).map((c, ci) => {
            // Position callouts relative to post index — header ~55px, each row ~40px
            const top = 55 + c.afterIndex * 40;
            return (
              <div
                key={ci}
                style={{
                  position: "absolute",
                  left: "50%",
                  transform: "translateX(-50%)",
                  top,
                  background: "#e8824a",
                  color: "#fff",
                  borderRadius: 12,
                  padding: "8px 16px",
                  fontSize: 14,
                  fontWeight: 700,
                  textAlign: "center",
                  zIndex: 2,
                  whiteSpace: "nowrap",
                  maxWidth: 300,
                }}
              >
                {c.text}
              </div>
            );
          })}
        </div>

        {/* Friend's view */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 8px" }}>
          <div style={{ fontWeight: 900, fontSize: 26, color: "#1a2c3a" }}>friend&rsquo;s view</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2c3a", opacity: 0.6, marginBottom: 16 }}>
            episodes watched: {panel.friendEp}
          </div>
          {panel.posts.map((p, i) => (
            <div key={`f-${i}`} style={{ marginBottom: 8, position: "relative" }}>
              <Pill label={p.label} owner={p.owner} isVisible={p.visible[1]} />
              {i === firstInvisFriend && (
                <div
                  style={{
                    position: "absolute",
                    right: -100,
                    top: -8,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    transform: "rotate(-20deg)",
                    color: "#f45028",
                    fontSize: 13,
                    fontWeight: 700,
                    fontStyle: "italic",
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                  }}
                >
                  <ArrowUpLeft size={18} color="#f45028" />
                  invisible post
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Narrative text at bottom */}
      {panel.narrative && (
        <div style={{ display: "flex", justifyContent: "center", padding: "24px 16px 0" }}>
          <div
            style={{
              background: "#e8824a",
              color: "#fff",
              borderRadius: 16,
              padding: "14px 24px",
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.55,
              maxWidth: 560,
              textAlign: "center",
            }}
          >
            {panel.narrative}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

const PANEL_HEIGHT = 620;

export default function HowItWorks() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const isLast = step === panels.length - 1;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#faf6ef",
        fontFamily: '"Inter","Nunito",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        color: "#1a2c3a",
        padding: "32px 16px 80px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* Back link */}
      <div style={{ width: "100%", maxWidth: 820, marginBottom: 24 }}>
        <button
          onClick={() => navigate("/")}
          style={{
            background: "transparent",
            border: "2px solid #1a2c3a",
            borderRadius: 9999,
            padding: "6px 14px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            color: "#1a2c3a",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <ArrowLeft size={14} /> back to Sidebar
        </button>
      </div>

      {/* Header banner */}
      <div
        style={{
          background: "#dea838",
          color: "#fff",
          borderRadius: 9999,
          padding: "10px 28px",
          fontSize: 18,
          fontWeight: 800,
          marginBottom: 28,
          textAlign: "center",
        }}
      >
        How does the no-spoiler mechanic work?
      </div>

      {/* Fixed-size panel container */}
      <div
        style={{
          width: "100%",
          maxWidth: 820,
          height: PANEL_HEIGHT,
          overflow: "hidden",
          position: "relative",
          borderRadius: 24,
          background: "rgba(255,255,255,0.5)",
          padding: 24,
          boxSizing: "border-box",
        }}
      >
        <div style={{ height: "100%", overflow: "auto" }}>
          <PanelContent panel={panels[step]} />
        </div>
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 28 }}>
        <button
          onClick={() => setStep(s => Math.max(0, s - 1))}
          disabled={step === 0}
          style={{
            background: "transparent",
            border: "2px solid #1a2c3a",
            borderRadius: 9999,
            padding: "8px 18px",
            cursor: step === 0 ? "default" : "pointer",
            opacity: step === 0 ? 0.3 : 1,
            fontSize: 14,
            fontWeight: 600,
            color: "#1a2c3a",
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
                background: i === step ? "#1a2c3a" : "rgba(26,44,58,0.25)",
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
            background: isLast ? "#7abd8e" : "transparent",
            border: isLast ? "2px solid #7abd8e" : "2px solid #1a2c3a",
            borderRadius: 9999,
            padding: "8px 18px",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600,
            color: isLast ? "#fff" : "#1a2c3a",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {isLast ? "got it" : "next"} <ArrowRight size={14} />
        </button>
      </div>

      <div style={{ marginTop: 12, fontSize: 13, opacity: 0.5, fontWeight: 600 }}>
        {step + 1} / {panels.length}
      </div>
    </div>
  );
}
