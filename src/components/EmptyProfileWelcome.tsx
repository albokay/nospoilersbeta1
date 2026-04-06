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
          This is your personal record of everything you've written on Sidebar — private entries saved just for you, and public entries you've sent to the rooms you're part of. They both live here together.
        </p>
        <p style={bodyStyle}>
          You can use private entries however you want. They can be drafts that you switch to public later, or just private thoughts that no one else ever sees.
        </p>
        <p style={{ ...bodyStyle, margin: 0, opacity: 0.65, fontStyle: "italic" }}>
          Start your journal by clicking "make an entry" in a show's room.
        </p>
      </div>
    </div>
  );
}
