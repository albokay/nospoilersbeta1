import React, { useEffect, useState } from "react";

const BLOCK = 52;

const BLOCKS = [
  { id: "green",     color: "#dea838", z: 1, blend: "color-burn" },
  { id: "white",     color: "#fffaf0", z: 2, blend: "color-burn" },
  { id: "lightBlue", color: "#adc8d7", z: 3, blend: "color-burn" },
  { id: "orange",    color: "#f45028", z: 4, blend: "multiply"   },
  { id: "blue",      color: "#355eb8", z: 5, blend: "color-burn" },
] as const;

// Context background colors set by body classes (see theme.ts).
// When a block matches the current context bg, it disappears against its
// surroundings — render that block 10% darker so it stays visible.
const CONTEXT_BG: Record<string, string> = {
  "group-context":  "#adc8d7", // matches the lightBlue block
  "public-context": "#dea838", // matches the green block (canon yellow)
  // default (private/home) bg is #7abd8e — doesn't match any block, so no darkening.
};

function darken10(hex: string): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const dr = Math.round(r * 0.9);
  const dg = Math.round(g * 0.9);
  const db = Math.round(b * 0.9);
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

type BlockId = (typeof BLOCKS)[number]["id"];
type Pos = { x: number; y: number };
type Layout = Record<BlockId, Pos>;

// Four arrangements matched to reference screenshots.
// Canvas: 280×148px. Block: 52×52px. Logo: left=45, bottom=0.
// Z-order: green(1) < white(2) < lightBlue(3) < orange(4) < blue(5)
const ARRANGEMENTS: Layout[] = [
  // 1 · white upper-left of cluster, orange overlapping below-right of white,
  //     lightBlue to the right of white/orange, blue isolated far upper-right,
  //     green isolated lower-left
  {
    white:     { x: 65,  y: 8  },
    orange:    { x: 105, y: 44 },
    lightBlue: { x: 144, y: 24 },
    blue:      { x: 220, y: 5  },
    green:     { x: -8,  y: 90 },
  },
  // 2 · lightBlue→blue→white staircase climbing upper-right,
  //     orange isolated lower-left at text level, green isolated lower-center
  {
    lightBlue: { x: 97,  y: 40  },
    blue:      { x: 125, y: 16  },
    white:     { x: 160, y: 1   },
    orange:    { x: -3,  y: 76  },
    green:     { x: 58,  y: 100 },
  },
  // 3 · white upper-left, green overlapping white lower-right,
  //     orange overlapping green lower-left (at text level),
  //     lightBlue upper-right cluster, blue overlapping lightBlue lower-right
  {
    white:     { x: 5,   y: 13 },
    green:     { x: 26,  y: 44 },
    orange:    { x: -11, y: 80 },
    lightBlue: { x: 174, y: 36 },
    blue:      { x: 204, y: 61 },
  },
  // 4 · lightBlue upper-left, blue overlapping lightBlue lower-left,
  //     white upper-center, orange center, green isolated lower-right (behind "bar")
  {
    lightBlue: { x: -8,  y: 4   },
    blue:      { x: -24, y: 29  },
    white:     { x: 75,  y: 19  },
    orange:    { x: 40,  y: 66  },
    green:     { x: 168, y: 94  },
  },
];

const SCATTER_X: [number, number] = [-45, 193];
const SCATTER_Y: [number, number] = [30, 150];

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface SidebarLogoProps {
  scale?: number;
  duration?: number;
  stagger?: number;
  /**
   * Opacity applied to the 5 colored blocks (0..1). The wordmark PNG
   * (z-index 6) is unaffected. Used by the homepage AnimatedLogo
   * scroll-shrink animation to dissolve the playful blocks as the
   * logo settles into the smaller header form, leaving just the
   * type-only wordmark. Default: 1 (no fade — full dynamic logo).
   */
  blocksOpacity?: number;
  /**
   * When set, the "sidebar" wordmark renders as a solid fill of this color
   * (via a CSS mask of the wordmark PNG) instead of the default art. Used by
   * the first-login OnboardingModal to show the wordmark in canon yellow on
   * the cream surface. Default: undefined (the normal PNG renders).
   */
  wordmarkTint?: string;
}

export default function SidebarLogo({
  scale = 1,
  duration = 750,
  stagger = 40,
  blocksOpacity = 1,
  wordmarkTint,
}: SidebarLogoProps) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [settled, setSettled] = useState(false);

  // Track the current context bg so the matching block can be rendered 10%
  // darker (otherwise it disappears against the page background). Reads
  // document.body.classList and updates via MutationObserver, since the
  // context classes are toggled imperatively by ShowSection / PublicProfilePage.
  const [contextBg, setContextBg] = useState<string | null>(() => {
    if (typeof document === "undefined") return null;
    for (const cls of Object.keys(CONTEXT_BG)) {
      if (document.body.classList.contains(cls)) return CONTEXT_BG[cls];
    }
    return null;
  });
  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => {
      let next: string | null = null;
      for (const cls of Object.keys(CONTEXT_BG)) {
        if (document.body.classList.contains(cls)) { next = CONTEXT_BG[cls]; break; }
      }
      setContextBg(prev => (prev === next ? prev : next));
    };
    const obs = new MutationObserver(update);
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const target =
      ARRANGEMENTS[Math.floor(Math.random() * ARRANGEMENTS.length)];

    const scatter = {} as Layout;
    for (const b of BLOCKS) {
      scatter[b.id] = { x: randInt(...SCATTER_X), y: randInt(...SCATTER_Y) };
    }
    setLayout(scatter);
    setSettled(false);

    let raf2: number;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setLayout(target);
        setSettled(true);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const W = 280;
  const H = 148;

  return (
    <div
      aria-label="sidebar"
      style={{
        position: "relative",
        width: W * scale,
        height: H * scale,
        userSelect: "none",
        overflow: "visible",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: W,
          height: H,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: "top left",
          isolation: "isolate",
        }}
      >
        {layout &&
          BLOCKS.map((block, i) => (
            <div
              key={block.id}
              style={{
                position: "absolute",
                width: BLOCK,
                height: BLOCK,
                borderRadius: 15,
                background: contextBg && contextBg.toLowerCase() === block.color.toLowerCase()
                  ? darken10(block.color)
                  : block.color,
                zIndex: block.z,
                mixBlendMode: block.blend as React.CSSProperties["mixBlendMode"],
                transform: `translate(${layout[block.id].x}px, ${layout[block.id].y}px)`,
                // Block opacity tracks the blocksOpacity prop directly —
                // no CSS transition so scroll-tied updates (from
                // HomepageNarrative's AnimatedLogo) follow the scroll
                // smoothly without animation lag.
                opacity: blocksOpacity,
                transition: settled
                  ? `transform ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94) ${i * stagger}ms`
                  : "none",
              }}
            />
          ))}

        {wordmarkTint ? (
          // Tinted wordmark: the PNG (aspect ~3.17) used as an alpha mask over a
          // solid canon-colored box → exact-color "sidebar" type. Width = 52 *
          // (3108/980) ≈ 165 to preserve the wordmark's proportions.
          <div
            aria-label="sidebar"
            style={{
              position: "absolute",
              left: 45,
              bottom: 0,
              height: 52,
              width: 165,
              zIndex: 6,
              background: wordmarkTint,
              WebkitMaskImage: "url(/sidebar-logo.png)",
              maskImage: "url(/sidebar-logo.png)",
              WebkitMaskSize: "contain",
              maskSize: "contain",
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskPosition: "left bottom",
              maskPosition: "left bottom",
            }}
          />
        ) : (
          <img
            src="/sidebar-logo.png"
            alt="sidebar"
            style={{
              position: "absolute",
              left: 45,
              bottom: 0,
              height: 52,
              width: "auto",
              display: "block",
              zIndex: 6,
              mixBlendMode: "normal",
            }}
          />
        )}
      </div>
    </div>
  );
}
