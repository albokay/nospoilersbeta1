import React, { useEffect } from "react";

const STYLE_ID = "wl-anim";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    /* Vertical bobbing — identical for both blocks */
    @keyframes wl-bob {
      0%   { animation-timing-function: cubic-bezier(0.45,0,0.55,1); transform: translateY(0px); }
      5%   { animation-timing-function: cubic-bezier(0.45,0,0.55,1); transform: translateY(-30px); }
      10%  { animation-timing-function: cubic-bezier(0.45,0,0.55,1); transform: translateY(0px); }
      15%  { animation-timing-function: cubic-bezier(0.45,0,0.55,1); transform: translateY(-20px); }
      20%  { animation-timing-function: cubic-bezier(0.45,0,0.55,1); transform: translateY(0px); }
      25%  { animation-timing-function: cubic-bezier(0.45,0,0.55,1); transform: translateY(-10px); }
      30%  { transform: translateY(0px); }
      100% { transform: translateY(0px); }
    }

    /* Horizontal movement — left block moves right to overlap */
    @keyframes wl-left {
      0%   { transform: translateX(0px); }
      42%  { animation-timing-function: cubic-bezier(0.45,0,0.55,1); transform: translateX(0px); }
      53%  { transform: translateX(40px); }
      61%  { animation-timing-function: cubic-bezier(0.45,0,0.55,1); transform: translateX(40px); }
      72%  { transform: translateX(0px); }
      100% { transform: translateX(0px); }
    }

    /* Horizontal movement — right block moves left to overlap */
    @keyframes wl-right {
      0%   { transform: translateX(0px); }
      42%  { animation-timing-function: cubic-bezier(0.45,0,0.55,1); transform: translateX(0px); }
      53%  { transform: translateX(-40px); }
      61%  { animation-timing-function: cubic-bezier(0.45,0,0.55,1); transform: translateX(-40px); }
      72%  { transform: translateX(0px); }
      100% { transform: translateX(0px); }
    }
  `;
  document.head.appendChild(el);
}

const DUR = "8s";

function AnimatedLogo() {
  const blockStyle: React.CSSProperties = { width: 32, height: 32, borderRadius: 4 };
  return (
    /* overflow: visible so upward bob isn't clipped */
    <div style={{ display: "flex", alignItems: "center", height: 80, overflow: "visible" }}>
      {/* Left (light-blue) block: outer handles X, inner handles Y */}
      <div style={{ animation: `wl-left ${DUR} linear infinite` }}>
        <div style={{ animation: `wl-bob ${DUR} linear infinite` }}>
          <div style={{ ...blockStyle, background: "#bdd4de" }} />
        </div>
      </div>

      {/* Spacer = two block widths = 64px */}
      <div style={{ width: 64, flexShrink: 0 }} />

      {/* Right (orange) block */}
      <div style={{ animation: `wl-right ${DUR} linear infinite` }}>
        <div style={{ animation: `wl-bob ${DUR} linear infinite` }}>
          <div style={{ ...blockStyle, background: "#f45028" }} />
        </div>
      </div>
    </div>
  );
}

export default function EmptyProfileWelcome() {
  useEffect(() => { injectStyles(); }, []);

  const bodyStyle: React.CSSProperties = {
    margin: "0 0 22px",
    fontSize: 19,
    fontWeight: 400,
    lineHeight: 1.8,
    color: "var(--dos-fg)",
  };

  return (
    <div style={{ maxWidth: 540, padding: "48px 0 40px" }}>
      <AnimatedLogo />

      <div style={{ marginTop: 44 }}>
        <p style={{ margin: "0 0 22px", fontSize: 22, fontWeight: 700, lineHeight: 1.5, color: "var(--dos-fg)", letterSpacing: 0.01 }}>
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
