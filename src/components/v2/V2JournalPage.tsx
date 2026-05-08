import React from "react";
import V2Layout from "./V2Layout";

export default function V2JournalPage() {
  return (
    <V2Layout
      palette="journal"
      pairedHeader={{
        left: "this is your journal",
        rightLabel: "go to your public profile",
        rightTo: "/v2/profile",
      }}
    >
      <section
        style={{
          background: "rgba(245,252,240,0.55)",
          border: "1.5px solid rgba(255,255,255,0.85)",
          borderRadius: 22,
          padding: "32px 36px 40px",
          color: "#1f2a26",
          minHeight: 320,
          boxShadow: "0 2px 18px rgba(0,0,0,0.06)",
        }}
      >
        <h1
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 700,
            fontSize: 38,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            lineHeight: 1.05,
            marginBottom: 8,
          }}
        >
          v2 journal
        </h1>
        <p
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 16,
            color: "#3a4a44",
          }}
        >
          shell is mounted. real journal lands in checkpoint 2.
        </p>
      </section>
    </V2Layout>
  );
}
