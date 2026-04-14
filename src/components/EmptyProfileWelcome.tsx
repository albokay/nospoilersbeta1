import React from "react";

export default function EmptyProfileWelcome() {
  const bodyStyle: React.CSSProperties = {
    margin: "0 0 14px",
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.6,
    color: "var(--dos-fg)",
    textAlign: "left",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "150px 0 48px" }}>
      <div style={{ width: "min(400px, 100%)" }}>
        <p style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, lineHeight: 1.4, color: "var(--dos-fg)", textAlign: "left" }}>
          Welcome to your journal.
        </p>
        <p style={bodyStyle}>
          This is your personal space on Sidebar — a record of everything you write about the shows you're watching.
        </p>
        <p style={bodyStyle}>
          Private entries are just for you. Public entries also appear when others browse the same show. Both live here together.
        </p>
        <p style={{ ...bodyStyle, margin: 0, opacity: 0.65, fontStyle: "italic" }}>
          A show appears here when you start a journal for it or create a friend room. Search for something you're watching and start there.
        </p>
      </div>
    </div>
  );
}
