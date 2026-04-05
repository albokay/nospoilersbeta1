import React, { useEffect } from "react";

const STYLE_ID = "wl-anim";

const BLOCK  = 52;
const GAP    = BLOCK * 2;              // 104px between edges
const TRAVEL = (GAP + BLOCK * 0.5) / 2; // 65px each → ~50% overlap

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  const eio = "cubic-bezier(0.45,0,0.55,1)";
  el.textContent = `
    /* Left block bobs UP */
    @keyframes wl-bob-up {
      0%   { animation-timing-function:${eio}; transform:translateY(0px); }
      5%   { animation-timing-function:${eio}; transform:translateY(-30px); }
      10%  { animation-timing-function:${eio}; transform:translateY(0px); }
      15%  { animation-timing-function:${eio}; transform:translateY(-20px); }
      20%  { animation-timing-function:${eio}; transform:translateY(0px); }
      25%  { animation-timing-function:${eio}; transform:translateY(-10px); }
      30%  { transform:translateY(0px); }
      100% { transform:translateY(0px); }
    }
    /* Right block bobs DOWN */
    @keyframes wl-bob-down {
      0%   { animation-timing-function:${eio}; transform:translateY(0px); }
      5%   { animation-timing-function:${eio}; transform:translateY(30px); }
      10%  { animation-timing-function:${eio}; transform:translateY(0px); }
      15%  { animation-timing-function:${eio}; transform:translateY(20px); }
      20%  { animation-timing-function:${eio}; transform:translateY(0px); }
      25%  { animation-timing-function:${eio}; transform:translateY(10px); }
      30%  { transform:translateY(0px); }
      100% { transform:translateY(0px); }
    }
    /* Horizontal approach/return — left moves right */
    @keyframes wl-left {
      0%   { transform:translateX(0px); }
      30%  { animation-timing-function:${eio}; transform:translateX(0px); }
      62%  { transform:translateX(${TRAVEL}px); }
      67%  { animation-timing-function:${eio}; transform:translateX(${TRAVEL}px); }
      99%  { transform:translateX(0px); }
      100% { transform:translateX(0px); }
    }
    /* Horizontal approach/return — right moves left */
    @keyframes wl-right {
      0%   { transform:translateX(0px); }
      30%  { animation-timing-function:${eio}; transform:translateX(0px); }
      62%  { transform:translateX(-${TRAVEL}px); }
      67%  { animation-timing-function:${eio}; transform:translateX(-${TRAVEL}px); }
      99%  { transform:translateX(0px); }
      100% { transform:translateX(0px); }
    }
  `;
  document.head.appendChild(el);
}

const DUR = "8s";

function AnimatedLogo() {
  const blockBase: React.CSSProperties = { width: BLOCK, height: BLOCK, borderRadius: 15 };
  return (
    // No isolation — blend modes see the yellow page background naturally
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: BLOCK + 36,
      overflow: "visible",
    }}>
      {/* Light-blue: bobs UP, moves right on approach */}
      <div style={{ animation: `wl-left ${DUR} linear infinite` }}>
        <div style={{ animation: `wl-bob-up ${DUR} linear infinite` }}>
          <div style={{ ...blockBase, background: "#bdd4de", mixBlendMode: "color-burn" }} />
        </div>
      </div>

      <div style={{ width: GAP, flexShrink: 0 }} />

      {/* Orange: bobs DOWN, moves left on approach */}
      <div style={{ animation: `wl-right ${DUR} linear infinite` }}>
        <div style={{ animation: `wl-bob-down ${DUR} linear infinite` }}>
          <div style={{ ...blockBase, background: "#f45028", mixBlendMode: "multiply" }} />
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
    textAlign: "left",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 0 40px" }}>
      <AnimatedLogo />

      <div style={{ width: "min(540px, 100%)", marginTop: 44 }}>
        <p style={{ margin: "0 0 22px", fontSize: 22, fontWeight: 700, lineHeight: 1.5, color: "var(--dos-fg)", textAlign: "left" }}>
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
