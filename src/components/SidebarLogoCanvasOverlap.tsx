import React, { useEffect, useRef } from "react";

const BLOCK = 19;
const W = 280;
const H = 148;
const PAD = 80; // canvas overflow padding so shapes aren't clipped at the edges
const DURATION = 750;
const STAGGER = 40;

const PALETTE = ["#f45028", "#dea838", "#fffaf0", "#adc8d7", "#355eb8"];

const BLOCKS = [
  { id: "green",     color: "#dea838" },
  { id: "white",     color: "#fffaf0" },
  { id: "lightBlue", color: "#adc8d7" },
  { id: "orange",    color: "#f45028" },
  { id: "blue",      color: "#355eb8" },
] as const;

type BlockId = (typeof BLOCKS)[number]["id"];
type Pos = { x: number; y: number };
type Layout = Record<BlockId, Pos>;

const ARRANGEMENTS: Layout[] = [
  {
    white:     { x: 65,  y: 8  },
    orange:    { x: 105, y: 44 },
    lightBlue: { x: 148, y: 24 },
    blue:      { x: 220, y: 5  },
    green:     { x: -8,  y: 90 },
  },
  {
    lightBlue: { x: 97,  y: 44  },
    blue:      { x: 125, y: 20  },
    white:     { x: 160, y: 5   },
    orange:    { x: 5,   y: 80  },
    green:     { x: 62,  y: 100 },
  },
  {
    white:     { x: 5,   y: 5  },
    green:     { x: 38,  y: 32 },
    orange:    { x: 5,   y: 72 },
    lightBlue: { x: 132, y: 5  },
    blue:      { x: 162, y: 30 },
  },
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

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Draw a shape centered at (cx, cy) with rotation in degrees.
// Paths for triangle and pentagon are centered at origin, inscribed in BLOCK/2 radius.
function drawDot(
  ctx: CanvasRenderingContext2D,
  shape: string,
  cx: number,
  cy: number,
  rot: number
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rot * Math.PI) / 180);
  const r = BLOCK / 2;
  switch (shape) {
    case "circle": {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "square": {
      const p = new Path2D();
      (p as any).roundRect(-r, -r, BLOCK, BLOCK, 3);
      ctx.fill(p);
      break;
    }
    case "triangle": {
      // Rounded equilateral triangle inscribed in r=9.5
      const p = new Path2D(
        "M -1.3 -6.9 Q 0 -9.5 1.3 -6.9 L 8.2 6.9 Q 9.5 9.5 6.5 9.5 L -6.5 9.5 Q -9.5 9.5 -8.2 6.9 Z"
      );
      ctx.fill(p);
      break;
    }
    case "pentagon": {
      const p = new Path2D(
        "M -1.9 -8.1 Q 0 -9.5 1.9 -8.1 L 7.6 -3.7 Q 9.5 -2.3 8.8 0 L 6.8 7.2 Q 6.1 9.5 3.7 9.5 L -3.7 9.5 Q -6.1 9.5 -6.8 7.2 L -8.8 0 Q -9.5 -2.3 -7.6 -3.7 Z"
      );
      ctx.fill(p);
      break;
    }
  }
  ctx.restore();
}

interface AnimDot {
  color: string;
  shape: string;
  startX: number; startY: number; startRot: number;
  endX: number;   endY: number;   endRot: number;
}

export interface SidebarLogoProps {
  scale?: number;
}

export default function SidebarLogo({ scale = 1 }: SidebarLogoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Scale canvas for HiDPI / Retina displays, with padding to avoid clipping
    const dpr = window.devicePixelRatio || 1;
    const CW = W + PAD * 2;
    const CH = H + PAD * 2;
    canvas.width = CW * dpr;
    canvas.height = CH * dpr;
    canvas.style.width = `${CW}px`;
    canvas.style.height = `${CH}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    // Offset all drawing so (0,0) of the layout maps to (PAD,PAD) on canvas
    ctx.translate(PAD, PAD);

    // Pick two distinct arrangements
    const i1 = Math.floor(Math.random() * ARRANGEMENTS.length);
    let i2 = Math.floor(Math.random() * (ARRANGEMENTS.length - 1));
    if (i2 >= i1) i2++;
    const arr1 = ARRANGEMENTS[i1];
    const arr2 = ARRANGEMENTS[i2];

    const spread = 0.719;
    const ox1 = randInt(-60, 60), oy1 = randInt(-10, 10);
    const ox2 = randInt(-60, 60), oy2 = randInt(-10, 10);

    const picked = shuffle(SHAPES).slice(0, 5);
    const shapeMap = Object.fromEntries(BLOCKS.map((b, i) => [b.id, picked[i]]));

    const dots: AnimDot[] = BLOCKS.flatMap(b => [
      {
        color: b.color, shape: shapeMap[b.id],
        startX: randInt(...SCATTER_X), startY: randInt(...SCATTER_Y), startRot: randInt(-180, 180),
        endX: arr1[b.id].x * spread + ox1 + 50, endY: arr1[b.id].y * spread + oy1 + 30, endRot: randInt(-150, 150),
      },
      {
        color: b.color, shape: shapeMap[b.id],
        startX: randInt(...SCATTER_X), startY: randInt(...SCATTER_Y), startRot: randInt(-180, 180),
        endX: arr2[b.id].x * spread + ox2 + 50, endY: arr2[b.id].y * spread + oy2 + 30, endRot: randInt(-150, 150),
      },
    ]);

    // Pre-assign a palette color to each unique pair (distinct from both shapes' colors)
    const overlapMap = new Map<string, string>();
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const c1 = dots[i].color, c2 = dots[j].color;
        const pool = PALETTE.filter(c => c !== c1 && c !== c2);
        overlapMap.set(`${i}-${j}`, pool[randInt(0, pool.length - 1)]);
      }
    }

    // Two reusable offscreen canvases for intersection computation
    const tmpA = document.createElement("canvas");
    const tmpB = document.createElement("canvas");
    tmpA.width = tmpB.width = CW * dpr;
    tmpA.height = tmpB.height = CH * dpr;
    const ctxA = tmpA.getContext("2d")!;
    const ctxB = tmpB.getContext("2d")!;
    ctxA.scale(dpr, dpr); ctxA.translate(PAD, PAD);
    ctxB.scale(dpr, dpr); ctxB.translate(PAD, PAD);

    const startTime = performance.now();
    let rafId: number;

    function render(now: number) {
      const elapsed = now - startTime;
      ctx.clearRect(-PAD, -PAD, CW, CH);

      // Interpolate current state for each dot
      const cur = dots.map((d, i) => {
        const t = easeOut(Math.max(0, Math.min(1, (elapsed - i * STAGGER) / DURATION)));
        return {
          x: d.startX + (d.endX - d.startX) * t + BLOCK / 2,
          y: d.startY + (d.endY - d.startY) * t + BLOCK / 2,
          rot: d.startRot + (d.endRot - d.startRot) * t,
          color: d.color,
          shape: d.shape,
        };
      });

      // 1. Draw all base shapes
      cur.forEach(d => {
        ctx.fillStyle = d.color;
        drawDot(ctx, d.shape, d.x, d.y, d.rot);
      });

      // 2. Draw intersection of each pair on top with its assigned color
      for (let i = 0; i < cur.length; i++) {
        for (let j = i + 1; j < cur.length; j++) {
          const overlapColor = overlapMap.get(`${i}-${j}`)!;
          const di = cur[i], dj = cur[j];

          // Draw shape i on tmpA (white = opaque mask)
          ctxA.clearRect(-PAD, -PAD, CW, CH);
          ctxA.fillStyle = "#fff";
          drawDot(ctxA, di.shape, di.x, di.y, di.rot);

          // Draw shape j on tmpB
          ctxB.clearRect(-PAD, -PAD, CW, CH);
          ctxB.fillStyle = "#fff";
          drawDot(ctxB, dj.shape, dj.x, dj.y, dj.rot);

          // Clip tmpA to intersection: keep only pixels present in both
          ctxA.globalCompositeOperation = "destination-in";
          ctxA.drawImage(tmpB, 0, 0, W, H);
          ctxA.globalCompositeOperation = "source-over";

          // Flood-fill the intersection mask with the overlap color
          ctxA.globalCompositeOperation = "source-in";
          ctxA.fillStyle = overlapColor;
          ctxA.fillRect(-PAD, -PAD, CW, CH);
          ctxA.globalCompositeOperation = "source-over";

          // Stamp onto main canvas
          ctx.drawImage(tmpA, -PAD, -PAD, CW, CH);
        }
      }

      if (elapsed < DURATION + dots.length * STAGGER + 100) {
        rafId = requestAnimationFrame(render);
      }
    }

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

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
        }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ position: "absolute", top: -PAD, left: -PAD }}
        />
        <img
          src="/sidebar-logo.png"
          alt="sidebar"
          style={{
            position: "absolute",
            left: 45, bottom: 0,
            height: 52, width: "auto",
            display: "block",
            zIndex: 6,
          }}
        />
      </div>
    </div>
  );
}
