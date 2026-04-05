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
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 0 32px" }}>
      <div style={{ width: "min(400px, 100%)" }}>
        <p style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, lineHeight: 1.4, color: "var(--dos-fg)", textAlign: "left" }}>
          Welcome to your journal.
        </p>
        <p style={bodyStyle}>
          This is your personal record of everything you've written on Sidebar — private entries saved just for you, and public entries you've sent to the rooms you're part of. Both live here together.
        </p>
        <p style={bodyStyle}>
          Your journal is yours alone. No one sees your private entries. Public entries appear here alongside what others see in the room.
        </p>
        <p style={{ ...bodyStyle, margin: 0, opacity: 0.65, fontStyle: "italic" }}>
          Start by making an entry in a show's room. Or just write something and save it privately — no one needs to see it but you.
        </p>
      </div>
    </div>
  );
}
