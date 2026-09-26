import React from "react";
import { X, RefreshCw, CornerDownLeft } from "lucide-react";
import type { PromptEntry } from "../lib/promptData";
import { CANON } from "../styles/canon";
import { D } from "./dashboardChrome";

// Pass-3 grammar (Alborz 2026-09-22, mockup A, then his rev the same day):
// the card is the modal's tan (cream) with dark ink (Alborz's second rev); Caption 13 sentence-case label (the
// old 11px ALL-CAPS tracked label predates the "nothing under 13, one shout
// only" rule); the prompt itself in Lora Subtitle. Two S pills — rest:
// "Another" = Personal-green outline + green text, "Use this" = identity fill
// + cream text. NO press lift; hover is a COLOUR SWAP (the entry-ticket convention):
// Another → green fill + tan text, Use this → identity outline + text, no
// fill. Rules live in theme.ts (.prompt-v2-another / .prompt-v2-use) because
// inline styles can't hover. The × stays: neither button dismisses (Another
// shuffles, Use this inserts). The legacy .prompt-card classes still serve
// the dormant V1/V3 pages only.
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
        type="button"
        onClick={onClose}
        title="Close"
        aria-label="Close"
        style={{
          position: "absolute", top: 6, right: 6, zIndex: 2,
          width: 32, height: 32, borderRadius: "50%",
          background: "transparent", border: "none", cursor: "pointer",
          color: CANON.dark, opacity: 0.7, padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
        }}
      >
        <X size={16} />
      </button>
      <div style={{ ...D.type.caption, color: CANON.dark, opacity: 0.7, marginBottom: 8, paddingRight: 32 }}>
        Writing prompt
      </div>
      <p style={{ ...D.type.subtitle, color: CANON.dark, margin: "0 0 14px", paddingRight: 32 }}>
        {prompt.text}
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="prompt-v2-another"
          onClick={onShuffle}
          title="Try another prompt"
          style={{ ...pill, background: "transparent", color: "var(--green)", border: "2px solid var(--green)" }}
        >
          <RefreshCw size={14} />
          Another
        </button>
        <button
          type="button"
          className="prompt-v2-use"
          onClick={() => onInsert(prompt.text)}
          title="Insert this prompt into your letter"
          style={{ ...pill, background: CANON.identity, color: CANON.cream, border: `2px solid ${CANON.identity}` }}
        >
          <CornerDownLeft size={14} />
          Use this
        </button>
      </div>
    </div>
  );
}
