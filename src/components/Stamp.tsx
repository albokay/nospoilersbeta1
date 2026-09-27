import React from "react";
import { HatGlasses, Lock } from "lucide-react";
import { CANON } from "../styles/canon";

// The stamp (letters grammar, Alborz 2026-09-26): every letter wears its
// episode tag as a postage stamp at the ticket's top-right, tag set in
// Lora. Six looks; a letter picks one by a stable hash of its own id, so
// the same letter wears the same stamp on every device and visit with
// nothing stored. Three looks carry a baked-in tilt (+3°, −4°, +2°) so
// nothing is computed at render. Ink defaults to the ticket's cream.
// `sealed` adds the red lock riding the stamp's left edge (the gated
// stub); `rewatch` adds the rewatch glyph; `scale` shrinks the drawn box
// for /m (0.78) — a real smaller box, not a CSS transform, so anything
// positioned against it measures what is drawn.

export type StampVariant = 0 | 1 | 2 | 3 | 4 | 5;
export const STAMP_COUNT = 6;

/** FNV-1a over the letter's id → one of the six looks, forever. */
export function stampVariantFor(id: string): StampVariant {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % STAMP_COUNT) as StampVariant;
}

/** The unscaled box each look occupies (the SVG's own size). */
export const STAMP_BOX: Record<StampVariant, { w: number; h: number }> = {
  0: { w: 100, h: 76 }, // scalloped
  1: { w: 92, h: 68 },  // perforated frame (+3°)
  2: { w: 136, h: 68 }, // postmarked — cancel waves run off the right edge
  3: { w: 66, h: 90 },  // tall, tag stacked (−4°)
  4: { w: 118, h: 70 }, // cancelled with a heart, frameless
  5: { w: 120, h: 72 }, // round postmark (+2°)
};
const TILT: Record<StampVariant, number> = { 0: 0, 1: 3, 2: 0, 3: -4, 4: 0, 5: 2 };

const LORA = '"Lora", Georgia, serif';

// ── path builders (module-level constants below; nothing per render) ──
function scallop(W: number, H: number, r: number): string {
  const nt = Math.floor(W / (2 * r)), ns = Math.floor(H / (2 * r));
  const p: string[] = ["M0 0"];
  let x = 0, y = 0;
  for (let i = 0; i < nt; i++) { x += 2 * r; p.push(`A${r} ${r} 0 0 1 ${x} 0`); }
  for (let i = 0; i < ns; i++) { y += 2 * r; p.push(`A${r} ${r} 0 0 1 ${W} ${y}`); }
  x = W;
  for (let i = 0; i < nt; i++) { x -= 2 * r; p.push(`A${r} ${r} 0 0 1 ${x} ${H}`); }
  y = H;
  for (let i = 0; i < ns; i++) { y -= 2 * r; p.push(`A${r} ${r} 0 0 1 0 ${y}`); }
  return p.join(" ") + " Z";
}
function perforated(W: number, H: number, r: number, nx: number, ny: number): string {
  const p: string[] = ["M0 0"];
  for (let i = 0; i < nx; i++) { const cx = W * (i + 0.5) / nx; p.push(`L${(cx - r).toFixed(1)} 0 A${r} ${r} 0 0 0 ${(cx + r).toFixed(1)} 0`); }
  p.push(`L${W} 0`);
  for (let i = 0; i < ny; i++) { const cy = H * (i + 0.5) / ny; p.push(`L${W} ${(cy - r).toFixed(1)} A${r} ${r} 0 0 0 ${W} ${(cy + r).toFixed(1)}`); }
  p.push(`L${W} ${H}`);
  for (let i = 0; i < nx; i++) { const cx = W - W * (i + 0.5) / nx; p.push(`L${(cx + r).toFixed(1)} ${H} A${r} ${r} 0 0 0 ${(cx - r).toFixed(1)} ${H}`); }
  p.push(`L0 ${H}`);
  for (let i = 0; i < ny; i++) { const cy = H - H * (i + 0.5) / ny; p.push(`L0 ${(cy + r).toFixed(1)} A${r} ${r} 0 0 0 0 ${(cy - r).toFixed(1)}`); }
  return p.join(" ") + " Z";
}
function wave(x: number, y: number, seg: number, reps: number): string {
  let d = `M${x} ${y}`;
  for (let k = 0; k < reps; k++) d += ` c ${seg / 3} -7 ${(2 * seg) / 3} 7 ${seg} 0`;
  return d;
}
const P_SCALLOP = scallop(88, 64, 6);
const P_FRAME = perforated(92, 68, 5, 6, 4);
const P_TALL = perforated(66, 90, 7, 3, 4);
const P_HEART = "M96 8 c -4 -8 -16 -4 -12 5 c 3 6 12 11 12 11 s 9 -5 12 -11 c 4 -9 -8 -13 -12 -5 z";
const P_BASE = "M6 60 c 6 -6 12 6 18 0 s 12 6 18 0 s 12 6 18 0 s 12 6 18 0 s 12 6 18 0";

function Tag({ x, y, text, ink, size }: { x: number; y: number; text: string; ink: string; size: number }) {
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill={ink} fontFamily={LORA} fontSize={size} fontWeight={700}>{text}</text>
  );
}
function Waves({ x, y, ink, lw, n = 3, gap = 12, seg = 22, reps = 3 }: { x: number; y: number; ink: string; lw: number; n?: number; gap?: number; seg?: number; reps?: number }) {
  return (
    <g fill="none" stroke={ink} strokeOpacity={0.85} strokeWidth={lw} strokeLinecap="round">
      {Array.from({ length: n }, (_, i) => <path key={i} d={wave(x, y + i * gap, seg, reps)} />)}
    </g>
  );
}

function Look({ variant, label, ink, w, h, lw }: { variant: StampVariant; label: string; ink: string; w: number; h: number; lw: number }) {
  const common = { width: w, height: h, "aria-hidden": true as const, style: { display: "block", overflow: "visible" } as React.CSSProperties };
  switch (variant) {
    case 0:
      return (
        <svg {...common} viewBox="-6 -6 100 76">
          <path d={P_SCALLOP} fill="none" stroke={ink} strokeWidth={lw} />
          <Tag x={44} y={32} text={label} ink={ink} size={18} />
        </svg>
      );
    case 1: {
      // "Season\nEpisode" (the letter from Sidebar) stacks two words.
      const two = label.includes("\n") ? label.split("\n", 2) : null;
      return (
        <svg {...common} viewBox="0 0 92 68">
          <path d={P_FRAME} fill="none" stroke={ink} strokeWidth={lw} />
          <rect x={11} y={11} width={70} height={46} fill="none" stroke={ink} strokeWidth={lw} />
          {two
            ? (<><Tag x={46} y={25} text={two[0]} ink={ink} size={14} /><Tag x={46} y={43} text={two[1]} ink={ink} size={14} /></>)
            : <Tag x={46} y={34} text={label} ink={ink} size={17} />}
        </svg>
      );
    }
    case 2:
      return (
        <svg {...common} viewBox="0 0 136 68">
          <path d={P_FRAME} fill="none" stroke={ink} strokeWidth={lw} />
          <rect x={11} y={11} width={70} height={46} fill="none" stroke={ink} strokeWidth={lw} />
          <Tag x={40} y={34} text={label} ink={ink} size={17} />
          <Waves x={62} y={22} ink={ink} lw={lw} />
        </svg>
      );
    case 3: {
      const [a, b] = label.includes(" ") ? label.split(" ", 2) : [label, ""];
      return (
        <svg {...common} viewBox="0 0 66 90">
          <path d={P_TALL} fill="none" stroke={ink} strokeWidth={lw} />
          {b ? (<><Tag x={33} y={33} text={a} ink={ink} size={18} /><Tag x={33} y={58} text={b} ink={ink} size={18} /></>) : <Tag x={33} y={45} text={a} ink={ink} size={18} />}
        </svg>
      );
    }
    case 4:
      return (
        <svg {...common} viewBox="0 0 118 70">
          <Waves x={4} y={18} ink={ink} lw={lw} n={2} gap={12} seg={16} reps={2} />
          <Tag x={70} y={36} text={label} ink={ink} size={19} />
          <path d={P_HEART} fill="none" stroke={ink} strokeWidth={lw} strokeLinejoin="round" />
          <path d={P_BASE} fill="none" stroke={ink} strokeWidth={lw} strokeLinecap="round" />
        </svg>
      );
    case 5:
    default:
      return (
        <svg {...common} viewBox="0 0 120 72">
          <circle cx={34} cy={36} r={31} fill="none" stroke={ink} strokeWidth={lw} />
          <circle cx={34} cy={36} r={24} fill="none" stroke={ink} strokeOpacity={0.5} strokeWidth={lw * 0.75} />
          <Tag x={34} y={36} text={label} ink={ink} size={16} />
          <Waves x={70} y={24} ink={ink} lw={lw} n={3} gap={12} seg={22} reps={2} />
        </svg>
      );
  }
}

export default function Stamp({ label, variant, ink = CANON.cream, scale = 1, sealed = false, rewatch = false, lineWidth, style }: {
  /** The tag, e.g. "S1 E2". */
  label: string;
  variant: StampVariant;
  ink?: string;
  scale?: number;
  sealed?: boolean;
  rewatch?: boolean;
  /** Line weight in the drawing's units. Default (Alborz 2026-09-26): 1.25 at
   *  full size — 2 read overbearing on desktop — and 2 for a shrunk box (/m at
   *  0.78 draws it at ~1.5px, so the lines stay a full pixel). */
  lineWidth?: number;
  style?: React.CSSProperties;
}) {
  const box = STAMP_BOX[variant];
  const w = Math.round(box.w * scale), h = Math.round(box.h * scale);
  const tilt = TILT[variant];
  const disc = Math.round(44 * scale);
  const lw = lineWidth ?? (scale < 1 ? 2 : 1.25);
  return (
    <span role="img" aria-label={sealed ? `sealed letter, ${label.replace("\n", " ")}` : label.replace("\n", " ")} style={{ position: "relative", display: "inline-block", width: w, height: h, verticalAlign: "top", ...style }}>
      <span style={{ display: "block", width: w, height: h, transform: tilt ? `rotate(${tilt}deg)` : undefined, transformOrigin: "center" }}>
        <Look variant={variant} label={label} ink={ink} w={w} h={h} lw={lw} />
      </span>
      {rewatch && (
        <HatGlasses size={Math.round(15 * scale)} color={CANON.alert} aria-hidden style={{ position: "absolute", left: Math.round(4 * scale), bottom: Math.round(2 * scale) }} />
      )}
      {sealed && (
        <span aria-hidden style={{ position: "absolute", left: -disc / 2, top: "50%", transform: "translateY(-50%)", width: disc, height: disc, borderRadius: "50%", background: CANON.alert, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Lock size={Math.round(20 * scale)} color={CANON.cream} strokeWidth={2.4} />
        </span>
      )}
    </span>
  );
}
