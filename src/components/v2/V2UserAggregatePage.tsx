import React from "react";
import V2Layout from "./V2Layout";

export default function V2UserAggregatePage({ username, showId }: { username: string; showId: string }) {
  return (
    <V2Layout palette="profile">
      <section
        style={{
          background: "var(--dos-bg)",
          border: "2px solid #fff",
          padding: "28px 32px",
          color: "var(--dos-fg)",
          minHeight: 320,
        }}
      >
        <div
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 15,
            color: "var(--dos-gray)",
            marginBottom: 4,
          }}
        >
          @{username}'s public posts on:
        </div>
        <h1
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 600,
            fontSize: 34,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            lineHeight: 1.05,
            marginBottom: 8,
          }}
        >
          {showId}
        </h1>
        <p
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 16,
            color: "var(--dos-gray)",
          }}
        >
          shell is mounted. pre-claim + post-claim states land in checkpoint 7.
        </p>
      </section>
    </V2Layout>
  );
}
