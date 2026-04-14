import React from "react";
import { X } from "lucide-react";
import type { PromptEntry } from "../lib/promptData";

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
            color: "#000",
          }}
        >
          {prompt.text}
        </p>
      </div>
      {/* Right: buttons stacked vertically */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <button className="close-x" onClick={onClose} title="Close">
          <X size={14} />
        </button>
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
