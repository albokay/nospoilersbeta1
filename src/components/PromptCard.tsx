import React from "react";
import { X, RefreshCw, CornerDownLeft } from "lucide-react";
import type { PromptEntry } from "../lib/promptData";
import { CANON } from "../styles/canon";
import { D } from "./dashboardChrome";

// Pass-3 grammar (Alborz 2026-09-22, mockup A): the prompt is an INFO surface,
// so the card is cream — sky was retired as an info/overlay colour. Caption 13
// sentence-case label (the old 11px ALL-CAPS tracked label predates the
// "nothing under 13, one shout only" rule), the prompt itself in Lora Subtitle
// (a statement is Lora), two S pills — "Use this" = identity fill + cream text
// (the send flip), "Another" = the on-cream sky-outline Cancel idiom (nothing is
// lost) — with lucide glyphs instead of typed ↻ ↵, and .d-press. The × stays:
// neither button dismisses (Another shuffles, Use this inserts). The legacy
// .prompt-card classes in theme.ts still serve the dormant V1/V3 pages only.
interface PromptCardProps {
  prompt: PromptEntry;
  onClose: () => void;
  onShuffle: () => void;
  onInsert: (text: string) => void;
}

const card: React.CSSProperties = {
  position: "relative",
  background: CANON.cream,
  color: CANON.dark,
  borderRadius: 16,
  padding: "16px 18px 14px",
  marginBottom: 12,
  boxSizing: "border-box",
};

const pill: React.CSSProperties = { ...D.pill.S, display: "inline-flex", alignItems: "center", gap: 6 };

export default function PromptCard({
  prompt,
  onClose,
  onShuffle,
  onInsert,
}: PromptCardProps) {
  return (
    <div className="prompt-card-v2" style={card}>
      <button
        onClick={onClose}
        title="Close"
        aria-label="Close"
        style={{
          position: "absolute", top: 10, right: 10,
          background: "transparent", border: "none", cursor: "pointer",
          color: CANON.dark, opacity: 0.6, padding: 4, display: "flex", lineHeight: 1,
        }}
      >
        <X size={16} />
      </button>
      <div style={{ ...D.type.caption, color: CANON.dark, opacity: 0.7, marginBottom: 8, paddingRight: 28 }}>
        Writing prompt
      </div>
      <p style={{ ...D.type.subtitle, color: CANON.dark, margin: "0 0 14px", paddingRight: 28 }}>
        {prompt.text}
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        <button
          className="d-press"
          onClick={onShuffle}
          title="Try another prompt"
          style={{ ...pill, background: "transparent", color: CANON.dark, border: `2px solid ${CANON.friend}` }}
        >
          <RefreshCw size={14} />
          Another
        </button>
        <button
          className="d-press"
          onClick={() => onInsert(prompt.text)}
          title="Insert this prompt into your post"
          style={{ ...pill, background: CANON.identity, color: CANON.cream, border: `2px solid ${CANON.identity}` }}
        >
          <CornerDownLeft size={14} />
          Use this
        </button>
      </div>
    </div>
  );
}
