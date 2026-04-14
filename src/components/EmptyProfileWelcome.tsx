import React from "react";

export default function EmptyProfileWelcome({ isTsp = false }: { isTsp?: boolean }) {
  const bodyStyle: React.CSSProperties = {
    margin: "0 0 14px",
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.6,
    color: "var(--dos-fg)",
    textAlign: "left",
  };

  if (isTsp) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "150px 0 48px" }}>
        <div style={{ width: "min(400px, 100%)" }}>
          <p style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, lineHeight: 1.4, color: "var(--dos-fg)", textAlign: "left" }}>
            Welcome to Sidebar.
          </p>
          <p style={bodyStyle}>
            Your journal is your personal space on Sidebar — a record of everything you write about the shows you're watching. Private entries are just for you. Public entries also appear when others search for the same show. Both live here together.
          </p>
          <p style={bodyStyle}>
            We've set you up with a demo journal for a pretend show called The Sidebar Protocol so you can see how the site works. Try changing your watch progress at the top of the page — that's the heart of how Sidebar works.
          </p>
          <p style={bodyStyle}>
            Browse the entries, write something, or invite a friend to (pretend) watch The Sidebar Protocol with you.
          </p>
          <p style={{ ...bodyStyle, margin: 0, opacity: 0.65, fontStyle: "italic" }}>
            When you're ready, search for a show you're actually watching and start there.
          </p>
        </div>
      </div>
    );
  }

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
