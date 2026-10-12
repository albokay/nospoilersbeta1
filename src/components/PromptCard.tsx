import React from "react";
import { X, RefreshCw, CornerDownLeft } from "lucide-react";
import type { PromptEntry } from "../lib/promptData";
import { CANON } from "../styles/canon";
import { D } from "./dashboardChrome";
import { E } from "../styles/editorial";

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
  /** The editorial skin (checkpoint 6): a framed cream paper — the caption
   *  in mono, the prompt in Lora, "Another" as a mono word, "Use this" as
   *  an ink block. Behaviour unchanged. */
  editorial?: boolean;
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
  editorial = false,
}: PromptCardProps) {
  if (editorial) {
    return (
      <div style={{ position: "relative", background: E.color.cream, color: E.color.ink, border: `1px solid ${E.color.ink}`, boxShadow: "0 1px 0 rgba(26,58,74,0.35)", padding: "16px 18px 14px", marginBottom: 12, boxSizing: "border-box" }}>
        <button type="button" onClick={onClose} title="Close" aria-label="Close" style={{ position: "absolute", top: 6, right: 6, zIndex: 2, width: 32, height: 32, background: "transparent", border: "none", cursor: "pointer", color: E.color.ink, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
          <X size={16} />
        </button>
        <div style={{ ...E.type.label10, color: E.color.inkMuted, marginBottom: 8, paddingRight: 32 }}>Writing prompt</div>
        <p style={{ ...E.type.letterBody16, margin: "0 0 14px", paddingRight: 32 }}>{prompt.text}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <button type="button" onClick={onShuffle} title="Try another prompt" style={{ ...E.type.label11, background: "transparent", border: 0, padding: "8px 0", cursor: "pointer", color: E.color.ink, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={13} /> Another
          </button>
          <button type="button" onClick={() => onInsert(prompt.text)} title="Insert this prompt into your letter" style={{ ...E.type.label11, height: 34, padding: "0 14px", background: E.color.ink, color: E.color.cream, border: 0, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <CornerDownLeft size={13} /> Use this
          </button>
        </div>
      </div>
    );
  }
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
