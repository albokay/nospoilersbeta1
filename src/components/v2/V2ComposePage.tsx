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
            color: "rgba(26,58,74,0.65)",
            marginBottom: 4,
          }}
        >
          capture your fresh thoughts on:
        </div>
        <h1
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 600,
            fontSize: 34,
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
          background: "#fff",
          border: "2px solid #1a3a4a",
          padding: "28px 32px",
          color: "#1a3a4a",
          minHeight: 240,
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <p
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 16,
            color: "rgba(26,58,74,0.7)",
          }}
        >
          shell is mounted. ruled-paper textarea, prompt feature, and destination chooser land in checkpoint 6.
        </p>
      </section>
    </V2Layout>
  );
}
