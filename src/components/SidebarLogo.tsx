import React, { useEffect, useState } from "react";

const BLOCK = 52;

const BLOCKS = [
  { id: "green",     color: "#7abd8e", z: 1, blend: "color-burn" },
  { id: "white",     color: "#fffaf0", z: 2, blend: "color-burn" },
  { id: "lightBlue", color: "#bdd4de", z: 3, blend: "color-burn" },
  { id: "orange",    color: "#f45028", z: 4, blend: "multiply"   },
  { id: "blue",      color: "#2256c9", z: 5, blend: "color-burn" },
] as const;

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
    lightBlue: { x: 148, y: 24 },
    blue:      { x: 220, y: 5  },
    green:     { x: -8,  y: 90 },
  },
  // 2 · lightBlue→blue→white staircase climbing upper-right,
  //     orange isolated lower-left at text level, green isolated lower-center
  {
    lightBlue: { x: 97,  y: 44  },
    blue:      { x: 125, y: 20  },
    white:     { x: 160, y: 5   },
    orange:    { x: 5,   y: 80  },
    green:     { x: 62,  y: 100 },
  },
  // 3 · white upper-left, green overlapping white lower-right,
  //     orange overlapping green lower-left (at text level),
  //     lightBlue upper-right cluster, blue overlapping lightBlue lower-right
  {
    white:     { x: 5,   y: 5  },
    green:     { x: 38,  y: 32 },
    orange:    { x: 5,   y: 72 },
    lightBlue: { x: 132, y: 5  },
    blue:      { x: 162, y: 30 },
  },
  // 4 · lightBlue upper-left, blue overlapping lightBlue lower-left,
  //     white upper-center, orange center, green isolated lower-right (behind "bar")
  {
    lightBlue: { x: -8,  y: -10 },
    blue:      { x: -28, y: 15  },
    white:     { x: 75,  y: 5   },
    orange:    { x: 40,  y: 52  },
    green:     { x: 168, y: 88  },
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
}

export default function SidebarLogo({
  scale = 1,
  duration = 750,
  stagger = 40,
}: SidebarLogoProps) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [settled, setSettled] = useState(false);

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
                background: block.color,
                zIndex: block.z,
                mixBlendMode: block.blend as React.CSSProperties["mixBlendMode"],
                transform: `translate(${layout[block.id].x}px, ${layout[block.id].y}px)`,
                transition: settled
                  ? `transform ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94) ${i * stagger}ms`
                  : "none",
              }}
            />
          ))}

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
      </div>
    </div>
  );
}
