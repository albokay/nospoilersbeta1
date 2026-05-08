import React from "react";
import V2Layout from "./V2Layout";

export default function V2ComposePage({ showId }: { showId?: string }) {
  return (
    <V2Layout palette="compose">
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 15,
            color: "#8a7860",
            marginBottom: 4,
          }}
        >
          capture your fresh thoughts on:
        </div>
        <h1
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 700,
            fontSize: 36,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            color: "#1a3a4a",
          }}
        >
          {showId ?? "—"}
        </h1>
      </div>
      <section
        style={{
          background: "#fdfbf3",
          border: "1.5px solid rgba(255,255,255,0.9)",
          borderRadius: 18,
          padding: "32px 36px",
          color: "#2b2418",
          minHeight: 240,
          maxWidth: 720,
          margin: "0 auto",
          boxShadow: "0 2px 18px rgba(43,36,24,0.05)",
        }}
      >
        <p
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 16,
            color: "#5a4d3a",
          }}
        >
          shell is mounted. ruled-paper textarea, prompt feature, and destination chooser land in checkpoint 6.
        </p>
      </section>
    </V2Layout>
  );
}
