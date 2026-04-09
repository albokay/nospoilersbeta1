import React, { useEffect, useState } from "react";

const BLOCK = 16;

const BLOCKS = [
  { id: "green",     color: "#dea838", z: 1, blend: "exclusion" },
  { id: "white",     color: "#fffaf0", z: 2, blend: "screen" },
  { id: "lightBlue", color: "#bdd4de", z: 3, blend: "color-burn" },
  { id: "orange",    color: "#f45028", z: 4, blend: "exclusion" },
  { id: "blue",      color: "#2256c9", z: 5, blend: "exclusion" },
] as const;

type BlockId = (typeof BLOCKS)[number]["id"];
type Pos = { x: number; y: number };
type Layout = Record<BlockId, Pos>;

const ARRANGEMENTS: Layout[] = [
  {
    white:     { x: 65,  y: 8  },
    orange:    { x: 105, y: 44 },
    lightBlue: { x: 144, y: 24 },
    blue:      { x: 220, y: 5  },
    green:     { x: -8,  y: 90 },
  },
  {
    lightBlue: { x: 97,  y: 40  },
    blue:      { x: 125, y: 16  },
    white:     { x: 160, y: 1   },
    orange:    { x: -3,  y: 76  },
    green:     { x: 58,  y: 100 },
  },
  {
    white:     { x: 5,   y: 13 },
    green:     { x: 26,  y: 44 },
    orange:    { x: -11, y: 80 },
    lightBlue: { x: 174, y: 36 },
    blue:      { x: 204, y: 61 },
  },
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

// 3 circles out of 6 = favoring circles
const SHAPES = ["circle", "circle", "circle", "square", "triangle", "pentagon"];

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shapeStyle(shape: string): React.CSSProperties {
  switch (shape) {
    case "circle":
      return { borderRadius: "50%" };
    case "square":
      return { borderRadius: "3px" };
    case "triangle":
      // Paths offset by +8 to center within 16×16 element box
      return { clipPath: "path('M 6.9 2.2 Q 8 0 9.1 2.2 L 14.9 13.8 Q 16 16 13.5 16 L 2.5 16 Q 0 16 1.1 13.8 Z')" };
    case "pentagon":
      return { clipPath: "path('M 6.4 1.2 Q 8 0 9.6 1.2 L 14.4 4.9 Q 16 6.1 15.4 8 L 13.7 14.1 Q 13.1 16 11.1 16 L 4.9 16 Q 2.9 16 2.3 14.1 L 0.6 8 Q 0 6.1 1.6 4.9 Z')" };
    default:
      return {};
  }
}

type Dot = { color: string; z: number; blend: string; shape: string; rotation: number; x: number; y: number };

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
  const [dots, setDots] = useState<Dot[] | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    // Pick two distinct arrangements
    const i1 = Math.floor(Math.random() * ARRANGEMENTS.length);
    let i2 = Math.floor(Math.random() * (ARRANGEMENTS.length - 1));
    if (i2 >= i1) i2++;
    const arr1 = ARRANGEMENTS[i1];
    const arr2 = ARRANGEMENTS[i2];

    const picked = shuffle(SHAPES).slice(0, 5);
    const shapeMap = Object.fromEntries(BLOCKS.map((b, i) => [b.id, picked[i]]));

    const scattered: Dot[] = BLOCKS.flatMap(b => [
      { color: b.color, z: b.z, blend: b.blend, shape: shapeMap[b.id], rotation: randInt(-180, 180), x: randInt(...SCATTER_X), y: randInt(...SCATTER_Y) },
      { color: b.color, z: b.z, blend: b.blend, shape: shapeMap[b.id], rotation: randInt(-180, 180), x: randInt(...SCATTER_X), y: randInt(...SCATTER_Y) },
    ]);
    setDots(scattered);
    setSettled(false);

    const spread = 0.827;
    const ox1 = randInt(-60, 60), oy1 = randInt(-10, 10);
    const ox2 = randInt(-60, 60), oy2 = randInt(-10, 10);

    const target: Dot[] = BLOCKS.flatMap(b => [
      { color: b.color, z: b.z, blend: b.blend, shape: shapeMap[b.id], rotation: randInt(-150, 150), x: arr1[b.id].x * spread + ox1 + 50, y: arr1[b.id].y * spread + oy1 + 30 },
      { color: b.color, z: b.z, blend: b.blend, shape: shapeMap[b.id], rotation: randInt(-150, 150), x: arr2[b.id].x * spread + ox2 + 50, y: arr2[b.id].y * spread + oy2 + 30 },
    ]);

    let raf2: number;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setDots(target);
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
          top: 0, left: 0,
          width: W, height: H,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: "top left",
          isolation: "isolate",
        }}
      >
        {dots &&
          dots.map((dot, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                width: BLOCK,
                height: BLOCK,
                ...shapeStyle(dot.shape),
                background: dot.color,
                zIndex: dot.z,
                mixBlendMode: dot.blend as React.CSSProperties["mixBlendMode"],
                transform: `translate(${dot.x}px, ${dot.y}px) rotate(${dot.rotation}deg)`,
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
            left: 45, bottom: 0,
            height: 52, width: "auto",
            display: "block",
            zIndex: 6,
            mixBlendMode: "normal",
          }}
        />
      </div>
    </div>
  );
}
