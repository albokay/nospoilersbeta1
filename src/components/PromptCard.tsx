import React from "react";
import { X } from "lucide-react";
import type { PromptEntry } from "../lib/promptData";

// Canon refresh (help-system QA round 8): the X is a bare Business-colored
// mark in the card's top-right corner (matches the tip stickies' dismiss);
// "another" is Business outline/text; "use this" keeps Identity fill. Card
// colors live in theme.ts (.prompt-card / .prompt-card-btn).
interface PromptCardProps {
  prompt: PromptEntry;
  onClose: () => void;
  onShuffle: () => void;
  onInsert: (text: string) => void;
}

export default function PromptCard({
  prompt,
  onClose,
  onShuffle,
  onInsert,
}: PromptCardProps) {
  return (
    <div className="prompt-card" style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
      <button
        onClick={onClose}
        title="Close"
        aria-label="Close"
        style={{
          position: "absolute", top: 10, right: 10,
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--canon-business,#8daaba)", padding: 4, display: "flex", lineHeight: 1,
        }}
      >
        <X size={16} />
      </button>
      {/* Left: label + prompt text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.55,
            marginBottom: 10,
          }}
        >
          writing prompt
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 500,
            lineHeight: 1.6,
          }}
        >
          {prompt.text}
        </p>
      </div>
      {/* Right: buttons stacked, anchored to the card's bottom (the X owns
          the top corner). */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          gap: 6,
          flexShrink: 0,
          paddingTop: 24,
        }}
      >
        <button className="prompt-card-btn" onClick={onShuffle} title="Try another prompt">
          ↻ another
        </button>
        <button
          className="prompt-card-btn prompt-card-btn--use"
          onClick={() => onInsert(prompt.text)}
          title="Insert this prompt into your post"
        >
          ↵ use this
        </button>
      </div>
    </div>
  );
}
