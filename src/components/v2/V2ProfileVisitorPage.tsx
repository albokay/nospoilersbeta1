import React from "react";
import V2Layout from "./V2Layout";

export default function V2ProfileVisitorPage({ username }: { username: string }) {
  return (
    <V2Layout palette="profile">
      <section
        style={{
          background: "rgba(255,250,235,0.6)",
          border: "1.5px solid rgba(255,255,255,0.85)",
          borderRadius: 22,
          padding: "32px 36px 40px",
          color: "#2a1f0a",
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
          @{username}
        </h1>
        <p
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 16,
            color: "#4a3a1c",
          }}
        >
          visitor profile shell is mounted. contextual CTAs land in checkpoint 5.
        </p>
      </section>
    </V2Layout>
  );
}
