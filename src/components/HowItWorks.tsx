import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";

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

// ── 4 panels ───────────────────────────────────────────────────────────────
// Descending order (newest first). Invisible pills are omitted entirely —
// each side only shows what that viewer can see.

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
      { label: "YOUR post - ep 8", owner: "you", visible: [true, true] },
      { label: "YOUR post - ep 7", owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 9", owner: "friend", visible: [false, true] },
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
const YOUR_HEADER = "#375eb8";    // canon dark-blue
const FRIEND_HEADER = "#dea838";  // canon yellow
const EP_COLOR = "#f45028";       // canon red
const YOU_COLOR = "#375eb8";
const FRIEND_COLOR = "#dea838";

// ── Pill ────────────────────────────────────────────────────────────────────

function Pill({ label, owner }: { label: string; owner: "you" | "friend" }) {
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
        background: color,
        color: "#fff",
        border: "2px solid transparent",
      }}
    >
      {label}
    </div>
  );
}

// ── View box ───────────────────────────────────────────────────────────────

function ViewBox({
  title,
  epCount,
  posts,
  side,
  headerColor,
}: {
  title: string;
  epCount: number;
  posts: Post[];
  side: 0 | 1;
  headerColor: string;
}) {
  // Only show posts that are visible on this side
  const visiblePosts = posts.filter(p => p.visible[side]);

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
      <div style={{ fontWeight: 900, fontSize: 20, color: headerColor }}>{title}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: EP_COLOR, marginBottom: 14 }}>
        episodes watched: {epCount}
      </div>
      {visiblePosts.map((p, i) => (
        <div key={i} style={{ marginBottom: 7 }}>
          <Pill label={p.label} owner={p.owner} />
        </div>
      ))}
    </div>
  );
}

// ── Panel content ──────────────────────────────────────────────────────────

const PANEL_HEIGHT = 460;
const CAPTION_HEIGHT = 80;

function PanelContent({ panel }: { panel: Panel }) {
  return (
    <div style={{ display: "flex", gap: 12, height: "100%" }}>
      <ViewBox title="your view" epCount={panel.yourEp} posts={panel.posts} side={0} headerColor={YOUR_HEADER} />
      <ViewBox title="friend's view" epCount={panel.friendEp} posts={panel.posts} side={1} headerColor={FRIEND_HEADER} />
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

      {/* Fixed-size panel area */}
      <div style={{ width: "100%", maxWidth: 780, height: PANEL_HEIGHT }}>
        <PanelContent panel={panels[step]} />
      </div>

      {/* Caption — fixed height so nav stays put */}
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
        <div
          style={{
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
      </div>

      {/* Navigation */}
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
