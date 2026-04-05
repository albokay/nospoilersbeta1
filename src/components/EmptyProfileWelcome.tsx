import React, { useEffect } from "react";

const STYLE_ID = "wl-anim";

// Block = 52px (same as SidebarLogo). Gap = 2 blocks = 104px.
// 50% overlap = 26px → each block travels (104+26)/2 = 65px.
const BLOCK = 52;
const GAP   = BLOCK * 2;   // 104px
const TRAVEL = (GAP + BLOCK * 0.5) / 2; // 65px

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  // 8s loop, no big pauses:
  //   0–30%  : 3 decreasing bobs  (5% per half = 0.4s each)
  //   30–62% : approach           (2.56s, ease-in-out)
  //   62–67% : overlap rest       (0.4s)
  //   67–99% : return             (2.56s, ease-in-out)
  //   99–100%: seam               (0.08s)
  const eio = "cubic-bezier(0.45,0,0.55,1)";
  el.textContent = `
    @keyframes wl-bob {
      0%   { animation-timing-function:${eio}; transform:translateY(0px); }
      5%   { animation-timing-function:${eio}; transform:translateY(-30px); }
      10%  { animation-timing-function:${eio}; transform:translateY(0px); }
      15%  { animation-timing-function:${eio}; transform:translateY(-20px); }
      20%  { animation-timing-function:${eio}; transform:translateY(0px); }
      25%  { animation-timing-function:${eio}; transform:translateY(-10px); }
      30%  { transform:translateY(0px); }
      100% { transform:translateY(0px); }
    }
    @keyframes wl-left {
      0%   { transform:translateX(0px); }
      30%  { animation-timing-function:${eio}; transform:translateX(0px); }
      62%  { transform:translateX(${TRAVEL}px); }
      67%  { animation-timing-function:${eio}; transform:translateX(${TRAVEL}px); }
      99%  { transform:translateX(0px); }
      100% { transform:translateX(0px); }
    }
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
  const blockBase: React.CSSProperties = {
    width: BLOCK, height: BLOCK, borderRadius: 15,
  };
  return (
    // isolation:isolate so blend modes composite within this container
    <div style={{ display: "flex", alignItems: "center", height: BLOCK + 36, overflow: "visible", isolation: "isolate" }}>
      {/* Light-blue block: outer = X, inner = Y */}
      <div style={{ animation: `wl-left ${DUR} linear infinite` }}>
        <div style={{ animation: `wl-bob ${DUR} linear infinite` }}>
          <div style={{ ...blockBase, background: "#bdd4de", mixBlendMode: "color-burn" }} />
        </div>
      </div>

      {/* Fixed spacer = two block widths */}
      <div style={{ width: GAP, flexShrink: 0 }} />

      {/* Orange block */}
      <div style={{ animation: `wl-right ${DUR} linear infinite` }}>
        <div style={{ animation: `wl-bob ${DUR} linear infinite` }}>
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
      <div style={{ width: "min(540px, 100%)" }}>
        <AnimatedLogo />

        <div style={{ marginTop: 44 }}>
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
    </div>
  );
}
