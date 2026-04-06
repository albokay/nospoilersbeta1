import React from "react";
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
    <div className="prompt-card">
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
          margin: "0 0 16px",
          fontSize: 18,
          fontWeight: 500,
          lineHeight: 1.6,
          color: "#000",
        }}
      >
        {prompt.text}
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <button
          className="prompt-card-btn"
          onClick={onClose}
          title="Close"
        >
          ✕ close
        </button>
        <button
          className="prompt-card-btn"
          onClick={onShuffle}
          title="Try another prompt"
        >
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
