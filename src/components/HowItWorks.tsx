import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, MoveUpLeft } from "lucide-react";

// ── Data for each step ─────────────────────────────────────────────────────

type Post = {
  label: string;
  ep: number;
  owner: "you" | "friend";
  /** Whether each side can see it: [yourView, friendView] */
  visible: [boolean, boolean];
};

type Step = {
  yourEp: number;
  friendEp: number;
  posts: Post[];
  narrative: string;
  /** Optional callouts that float in the center divider area */
  callouts?: string[];
  /** Show the "invisible post" arrow annotation on the first invisible post */
  showArrow?: boolean;
};

const steps: Step[] = [
  {
    yourEp: 1,
    friendEp: 0,
    posts: [
      { label: "YOUR post - ep 1", ep: 1, owner: "you", visible: [true, false] },
    ],
    narrative:
      "You just watched the first episode of a show. You loved it and invited a friend to watch with you. You\u2019ve already made a post about the show. But since your friend hasn\u2019t started yet, they don\u2019t see your post yet.",
    showArrow: true,
  },
  {
    yourEp: 2,
    friendEp: 4,
    posts: [
      { label: "YOUR post - ep 1", ep: 1, owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 2", ep: 2, owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 4", ep: 4, owner: "friend", visible: [false, true] },
      { label: "YOUR post - ep 2", ep: 2, owner: "you", visible: [true, true] },
    ],
    narrative:
      "Later, your friend has written more and has watched ahead. But even though one of their posts was written before your second one, you don\u2019t see it until you catch up.",
  },
  {
    yourEp: 7,
    friendEp: 5,
    posts: [
      { label: "YOUR post - ep 1", ep: 1, owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 3", ep: 3, owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 4", ep: 4, owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 2", ep: 2, owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 4", ep: 4, owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 6", ep: 6, owner: "you", visible: [true, false] },
      { label: "FRIEND post - ep 5", ep: 5, owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 7", ep: 7, owner: "you", visible: [true, false] },
      { label: "YOUR post - ep 8", ep: 8, owner: "you", visible: [true, false] },
      { label: "FRIEND post - ep 6", ep: 6, owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 9", ep: 9, owner: "you", visible: [true, false] },
      { label: "FRIEND post - ep 7", ep: 7, owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 12", ep: 12, owner: "you", visible: [true, false] },
      { label: "FRIEND post - ep 8", ep: 8, owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 10", ep: 10, owner: "friend", visible: [true, true] },
      { label: "YOUR post - ep 13", ep: 13, owner: "you", visible: [true, false] },
    ],
    narrative:
      "This filtering is applied across the entire site: posts, responses, public posts.",
    callouts: ["Nobody has to hold back.", "Nobody gets spoiled."],
  },
  {
    yourEp: 15,
    friendEp: 19,
    posts: [
      { label: "YOUR post - ep 13", ep: 13, owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 14", ep: 14, owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 15", ep: 15, owner: "friend", visible: [true, true] },
      { label: "FRIEND post - ep 16", ep: 16, owner: "friend", visible: [false, true] },
      { label: "FRIEND post - ep 18", ep: 18, owner: "friend", visible: [false, true] },
      { label: "YOUR post - ep 14", ep: 14, owner: "you", visible: [true, true] },
      { label: "YOUR post - ep 15", ep: 15, owner: "you", visible: [true, true] },
      { label: "FRIEND post - ep 19", ep: 19, owner: "friend", visible: [false, true] },
    ],
    narrative: "",
    callouts: ["Invite a friend.", "Don\u2019t stop talking.", "Start an account."],
  },
];

// ── Pill component ─────────────────────────────────────────────────────────

function Pill({
  label,
  owner,
  isVisible,
}: {
  label: string;
  owner: "you" | "friend";
  isVisible: boolean;
}) {
  const solidBg = owner === "you" ? "#375eb8" : "#dea838";
  const solidColor = "#fff";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px 18px",
        borderRadius: 9999,
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
        lineHeight: 1.3,
        transition: "all 0.3s ease",
        ...(isVisible
          ? { background: solidBg, color: solidColor, border: "2px solid transparent" }
          : {
              background: "transparent",
              color: solidBg,
              border: `2px dashed ${solidBg}`,
              opacity: 0.5,
            }),
      }}
    >
      {label}
    </div>
  );
}

// ── Arrow annotation ───────────────────────────────────────────────────────

function InvisibleArrow() {
  return (
    <div
      style={{
        position: "absolute",
        right: -90,
        top: -12,
        display: "flex",
        alignItems: "center",
        gap: 4,
        transform: "rotate(-15deg)",
        color: "#f45028",
        fontSize: 13,
        fontWeight: 700,
        fontStyle: "italic",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      <MoveUpLeft size={18} color="#f45028" />
      invisible post
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function HowItWorks() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#faf6ef",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily:
          '"Inter","Nunito",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        color: "#1a2c3a",
        padding: "32px 16px 64px",
      }}
    >
      {/* Back link */}
      <div style={{ width: "100%", maxWidth: 800, marginBottom: 16 }}>
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
          marginBottom: 32,
          textAlign: "center",
        }}
      >
        How does the no-spoiler mechanic work?
      </div>

      {/* Split-screen container */}
      <div
        style={{
          display: "flex",
          width: "100%",
          maxWidth: 800,
          minHeight: 400,
          position: "relative",
        }}
      >
        {/* Your view */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "0 12px" }}>
          <div style={{ fontWeight: 900, fontSize: 28, color: "#1a2c3a", textAlign: "center" }}>
            your view
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2c3a", opacity: 0.6, marginBottom: 16 }}>
            episodes watched: {current.yourEp}
          </div>
          {current.posts.map((p, i) => {
            const isVis = p.visible[0];
            const showAnnotation = current.showArrow && !isVis && i === current.posts.findIndex(pp => !pp.visible[0]);
            return (
              <div key={`you-${i}`} style={{ position: "relative" }}>
                <Pill label={p.label} owner={p.owner} isVisible={isVis} />
              </div>
            );
          })}
        </div>

        {/* Center divider */}
        <div
          style={{
            width: 2,
            background: "rgba(26,44,58,0.15)",
            flexShrink: 0,
            position: "relative",
          }}
        >
          {/* Callouts float along the divider */}
          {current.callouts?.map((text, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                top: `${20 + i * 25}%`,
                background: "#e8824a",
                color: "#fff",
                borderRadius: 12,
                padding: "8px 16px",
                fontSize: 16,
                fontWeight: 700,
                whiteSpace: "nowrap",
                textAlign: "center",
                zIndex: 2,
              }}
            >
              {text}
            </div>
          ))}
        </div>

        {/* Friend's view */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "0 12px" }}>
          <div style={{ fontWeight: 900, fontSize: 28, color: "#1a2c3a", textAlign: "center" }}>
            friend&rsquo;s view
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2c3a", opacity: 0.6, marginBottom: 16 }}>
            episodes watched: {current.friendEp}
          </div>
          {current.posts.map((p, i) => {
            const isVis = p.visible[1];
            const showAnnotation = current.showArrow && !isVis && i === current.posts.findIndex(pp => !pp.visible[1]);
            return (
              <div key={`friend-${i}`} style={{ position: "relative" }}>
                <Pill label={p.label} owner={p.owner} isVisible={isVis} />
                {showAnnotation && <InvisibleArrow />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Narrative text */}
      {current.narrative && (
        <div
          style={{
            background: "#e8824a",
            color: "#fff",
            borderRadius: 16,
            padding: "14px 24px",
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1.5,
            maxWidth: 600,
            textAlign: "center",
            marginTop: 32,
          }}
        >
          {current.narrative}
        </div>
      )}

      {/* Step navigation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          marginTop: 40,
        }}
      >
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

        {/* Dots */}
        <div style={{ display: "flex", gap: 8 }}>
          {steps.map((_, i) => (
            <div
              key={i}
              onClick={() => setStep(i)}
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: i === step ? "#1a2c3a" : "rgba(26,44,58,0.25)",
                cursor: "pointer",
                transition: "background 0.2s",
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

      {/* Step counter */}
      <div style={{ marginTop: 12, fontSize: 13, opacity: 0.5, fontWeight: 600 }}>
        {step + 1} / {steps.length}
      </div>
    </div>
  );
}
