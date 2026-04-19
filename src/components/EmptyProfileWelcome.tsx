import React from "react";

export default function EmptyProfileWelcome({ isTsp = false, showName }: { isTsp?: boolean; showName?: string }) {
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
            Your journal is your home. Everything you write about the shows you watch lives here.
          </p>
          <p style={bodyStyle}>
            When you write, you choose who sees it: just you, the friends you&rsquo;ve invited, or anyone watching the same show. All of it is filtered to your watch progress, so nobody gets spoiled &mdash; ever.
          </p>
          <p style={bodyStyle}>
            You&rsquo;ve been set up with a demo journal and friend room for a pretend show called The Sidebar Protocol. The friends in there aren&rsquo;t real either. Click around, write something, change your watch progress at the top &mdash; that&rsquo;s the heart of how Sidebar works.
          </p>
          <p style={{ ...bodyStyle, margin: 0, opacity: 0.65, fontStyle: "italic" }}>
            When you&rsquo;re ready, search for a show you&rsquo;re actually watching and get started.
          </p>
        </div>
      </div>
    );
  }

  // Show-specific variant: rendered inside an active show tab that has
  // no entries yet. Prompts the user to write their first entry for
  // this show.
  if (showName) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "150px 0 48px" }}>
        <div style={{ width: "min(400px, 100%)" }}>
          <p style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, lineHeight: 1.4, color: "var(--dos-fg)", textAlign: "left" }}>
            You&rsquo;ve started your journal for {showName}.
          </p>
          <p style={bodyStyle}>
            Whether you&rsquo;ve just watched the pilot or you&rsquo;re well on your way, this is the place to put your thoughts.
          </p>
          <p style={{ ...bodyStyle, margin: 0, opacity: 0.65, fontStyle: "italic" }}>
            When you&rsquo;re ready, click write or invite some friends to write together.
          </p>
        </div>
      </div>
    );
  }

  // Generic variant: no active show context (rare — typically only
  // fires when the user has zero show tabs total).
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "150px 0 48px" }}>
      <div style={{ width: "min(400px, 100%)" }}>
        <p style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, lineHeight: 1.4, color: "var(--dos-fg)", textAlign: "left" }}>
          Welcome to your journal.
        </p>
        <p style={bodyStyle}>
          This is your personal space on Sidebar &mdash; a record of everything you write about the shows you&rsquo;re watching.
        </p>
        <p style={bodyStyle}>
          When you write, you choose who sees it: just you, the friends you&rsquo;ve invited, or anyone watching the same show. All of it is filtered to your watch progress, so nobody ever gets spoiled.
        </p>
        <p style={{ ...bodyStyle, margin: 0, opacity: 0.65, fontStyle: "italic" }}>
          A show appears here when you start a journal for it or create a friend room. Search for something you&rsquo;re watching and start there.
        </p>
      </div>
    </div>
  );
}
