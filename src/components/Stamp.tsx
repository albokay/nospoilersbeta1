import React from "react";
import { HatGlasses, Lock } from "lucide-react";
import { CANON } from "../styles/canon";

// The stamp (letters grammar, Alborz 2026-09-26): every letter wears its
// episode tag as a postage stamp at the ticket's top-right, tag set in
// Lora. ONE STAMP PER ACCOUNT (his round 2, same day): the writer's mark,
// generated from the account id the way the avatar is — the same person's
// letters, sealed ones included, always wear the same stamp, with nothing
// stored, and a first-name edit never changes it. Four variables you can
// tell apart at a glance: family (8 silhouettes) × ornament (6 marks, the
// first-name initial among them) × cancel mark (5) × tilt (3) = 720. Ink
// and size never vary, so every result stays a stamp and the tag keeps its
// room. Rules: the frameless looks take no wave marks and no corner
// postmark (none or the corner circle only); the single-wave frameless look
// is never bare — it carries an ornament and/or a mark. Lines are 1.5 at full size, 2 on a shrunk box
// (/m at 0.78 draws ~1.5px). `sealed` adds the red lock riding the frame's
// left edge; `rewatch` adds the rewatch glyph; `scale` shrinks the drawn
// box for /m as a real smaller box, not a CSS transform.

export type StampSpec = { family: number; ornament: number; cancel: number; tilt: number };

const TILTS = [-4, 0, 4];
export const FAMILY_COUNT = 8, ORNAMENT_COUNT = 6, CANCEL_COUNT = 5;
// families: 0 scalloped · 1 scalloped + box · 2 framed · 3 framed, no box ·
//           4 round · 5 tall · 6 frameless (one wave) · 7 frameless, three waves
// ornaments: 0 heart · 1 star · 2 envelope · 3 diamond · 4 initial · 5 none
// cancels:   0 none · 1 waves right · 2 waves left · 3 corner postmark · 4 corner circle

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** The account's stamp — seed with the user id (never a name). */
export function stampSpecFor(accountId: string): StampSpec {
  const h = fnv(accountId);
  const spec: StampSpec = { family: h % FAMILY_COUNT, ornament: (h >>> 3) % ORNAMENT_COUNT, cancel: (h >>> 6) % CANCEL_COUNT, tilt: TILTS[(h >>> 9) % 3] };
  // The frameless looks (their own waves already) never take the wave marks
  // or the corner postmark — too many wavy lines (Alborz 2026-09-26): only
  // none or the corner circle, from a spare bit.
  if (spec.family >= 6 && (spec.cancel === 1 || spec.cancel === 2 || spec.cancel === 3)) spec.cancel = ((h >>> 15) & 1) ? 4 : 0;
  // Never bare: the single-wave frameless look takes an ornament from a
  // spare bit when it would draw with neither ornament nor mark.
  if (spec.family === 6 && spec.ornament === 5 && spec.cancel === 0) spec.ornament = (h >>> 12) % 5;
  return spec;
}

type Fam = { W: number; H: number; bleed: number; kind: "scallop" | "frame" | "round" | "tall" | "free"; box?: boolean; lines?: number };
const FAM: Fam[] = [
  { W: 88, H: 64, bleed: 6, kind: "scallop" },
  { W: 88, H: 64, bleed: 6, kind: "scallop", box: true },
  { W: 92, H: 68, bleed: 0, kind: "frame", box: true },
  { W: 92, H: 68, bleed: 0, kind: "frame" },
  { W: 72, H: 72, bleed: 0, kind: "round" },
  { W: 66, H: 90, bleed: 0, kind: "tall" },
  { W: 104, H: 60, bleed: 0, kind: "free", lines: 1 },
  { W: 104, H: 72, bleed: 0, kind: "free", lines: 3 },
];

/** The unscaled box the whole drawing occupies (marks included) and where
 *  the frame sits inside it — for layout that must clear the stamp. */
export function stampBox(spec: StampSpec): { w: number; h: number; frameLeft: number; frameBottom: number } {
  const f = FAM[spec.family];
  // The wave marks sit mostly outside the frame (10 in, 26 out) so they
  // brush the tag instead of crossing it (Alborz 2026-09-26).
  const extL = spec.cancel === 2 ? 26 : 0;
  const extR = spec.cancel === 1 ? 26 : spec.cancel === 3 ? 28 : spec.cancel === 4 ? 9 : 0;
  const extT = spec.cancel === 3 || spec.cancel === 4 ? 9 : 0;
  return { w: f.W + extL + extR + 2 * f.bleed, h: f.H + extT + 2 * f.bleed, frameLeft: extL + f.bleed, frameBottom: f.bleed };
}

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
const P_SCALLOP = scallop(88, 64, 6);
const P_FRAME = perforated(92, 68, 5, 6, 4);
const P_TALL = perforated(66, 90, 7, 3, 4);
const P_HEART = "M0 4 c -4 -8 -14 -3 -10 5 c 3 5 10 9 10 9 s 7 -4 10 -9 c 4 -8 -6 -13 -10 -5 z";
const P_STAR = "M0 -9 L2.6 -3 L9 -2.6 L4.2 1.8 L5.6 8 L0 4.8 L-5.6 8 L-4.2 1.8 L-9 -2.6 L-2.6 -3 z";
const P_DIAMOND = "M0 -9 L8 0 L0 9 L-8 0 z";
const baseWave = (y: number) => `M4 ${y} c 6 -6 12 6 18 0 s 12 6 18 0 s 12 6 18 0 s 12 6 18 0 s 12 6 18 0`;
// Half-length waves (Alborz 2026-09-26): 36 long, 2 crests — the long ones
// made the whole stamp too big.
const cancelWave = (x: number, y: number) => `M${x} ${y} c 6 -7 12 7 18 0 s 12 7 18 0`;
const shortWave = (x: number, y: number) => `M${x} ${y} c 3 -5 6 5 9 0 s 6 5 9 0`;
const LORA = '"Lora", Georgia, serif';

function Tag({ x, y, text, ink, size }: { x: number; y: number; text: string; ink: string; size: number }) {
  return <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill={ink} fontFamily={LORA} fontSize={size} fontWeight={700}>{text}</text>;
}

function Ornament({ kind, cx, cy, s, ink, lw, initial }: { kind: number; cx: number; cy: number; s: number; ink: string; lw: number; initial: string }) {
  const t = `translate(${cx} ${cy}) scale(${s})`;
  const line = { fill: "none", stroke: ink, strokeWidth: lw, strokeLinejoin: "round" as const };
  switch (kind) {
    case 0: return <path transform={`translate(${cx} ${cy - 6}) scale(${s})`} d={P_HEART} {...line} />;
    case 1: return <path transform={t} d={P_STAR} {...line} />;
    case 2: return <g transform={t} {...line}><rect x={-9} y={-6} width={18} height={12} rx={1.5} /><path d="M-9 -6 L0 1 L9 -6" /></g>;
    case 3: return <path transform={t} d={P_DIAMOND} {...line} />;
    case 4: return <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill={ink} fontFamily={LORA} fontSize={Math.round(17 * s * 10) / 10} fontWeight={700}>{initial}</text>;
    default: return null;
  }
}

function Cancel({ kind, W, H, ink, lw }: { kind: number; W: number; H: number; ink: string; lw: number }) {
  const line = { fill: "none", stroke: ink, strokeWidth: lw, strokeLinecap: "round" as const };
  switch (kind) {
    case 1: return <g {...line}>{[0, 1, 2].map((i) => <path key={i} d={cancelWave(W - 10, H / 2 - 12 + i * 12)} />)}</g>;
    case 2: return <g {...line}>{[0, 1, 2].map((i) => <path key={i} d={cancelWave(-26, H / 2 - 12 + i * 12)} />)}</g>;
    case 3: return <g {...line}><circle cx={W - 6} cy={6} r={15} /><path d={shortWave(W + 10, 2)} /><path d={shortWave(W + 10, 12)} /></g>;
    case 4: return <g {...line}><circle cx={W - 6} cy={6} r={15} /></g>;
    default: return null;
  }
}

function Drawing({ spec, label, initial, ink, lw }: { spec: StampSpec; label: string; initial: string; ink: string; lw: number }) {
  const f = FAM[spec.family];
  const { W, H } = f;
  const hasOrn = spec.ornament !== 5 && !(spec.ornament === 4 && !initial);
  const orn = hasOrn ? spec.ornament : 5;
  const line = { fill: "none", stroke: ink, strokeWidth: lw };
  const stacked = label.includes("\n") ? label.split("\n", 2) : null;
  let body: React.ReactNode = null, tag: React.ReactNode = null, ornEl: React.ReactNode = null;
  if (f.kind === "scallop") {
    body = <>{<path d={P_SCALLOP} {...line} />}{f.box && <rect x={9} y={9} width={70} height={46} {...line} />}</>;
    tag = stacked
      ? <><Tag x={W / 2} y={H / 2 - 9} text={stacked[0]} ink={ink} size={14} /><Tag x={W / 2} y={H / 2 + 9} text={stacked[1]} ink={ink} size={14} /></>
      : <Tag x={W / 2 + (hasOrn ? 8 : 0)} y={H / 2 + (hasOrn ? 4 : 0)} text={label} ink={ink} size={17} />;
    ornEl = <Ornament kind={orn} cx={19} cy={17} s={0.9} ink={ink} lw={lw} initial={initial} />;
  } else if (f.kind === "frame") {
    body = <>{<path d={P_FRAME} {...line} />}{f.box && <rect x={11} y={11} width={70} height={46} {...line} />}</>;
    tag = stacked
      ? <><Tag x={W / 2} y={H / 2 - 9} text={stacked[0]} ink={ink} size={14} /><Tag x={W / 2} y={H / 2 + 9} text={stacked[1]} ink={ink} size={14} /></>
      : <Tag x={W / 2 + (hasOrn ? 8 : 0)} y={H / 2 + (hasOrn ? 4 : 0)} text={label} ink={ink} size={16} />;
    ornEl = <Ornament kind={orn} cx={23} cy={23} s={0.85} ink={ink} lw={lw} initial={initial} />;
  } else if (f.kind === "round") {
    body = <><circle cx={36} cy={36} r={34} {...line} /><circle cx={36} cy={36} r={27} fill="none" stroke={ink} strokeOpacity={0.5} strokeWidth={lw * 0.75} /></>;
    tag = <Tag x={36} y={hasOrn ? 42 : 36} text={label} ink={ink} size={15} />;
    ornEl = <Ornament kind={orn} cx={36} cy={22} s={0.75} ink={ink} lw={lw} initial={initial} />;
  } else if (f.kind === "tall") {
    const [a, b] = label.includes(" ") ? label.split(" ", 2) : [label, ""];
    body = <path d={P_TALL} {...line} />;
    tag = b
      ? <><Tag x={33} y={hasOrn ? 46 : 33} text={a} ink={ink} size={17} /><Tag x={33} y={hasOrn ? 68 : 58} text={b} ink={ink} size={17} /></>
      : <Tag x={33} y={45} text={a} ink={ink} size={17} />;
    ornEl = <Ornament kind={orn} cx={33} cy={22} s={0.85} ink={ink} lw={lw} initial={initial} />;
  } else {
    const ys = f.lines === 3 ? [44, 54, 64] : [50];
    body = <g {...line} strokeLinecap="round">{ys.map((y) => <path key={y} d={baseWave(y)} />)}</g>;
    tag = <Tag x={hasOrn ? 60 : 52} y={28} text={label} ink={ink} size={19} />;
    ornEl = <Ornament kind={orn} cx={18} cy={24} s={0.9} ink={ink} lw={lw} initial={initial} />;
  }
  return <>{body}{ornEl}<Cancel kind={spec.cancel} W={W} H={H} ink={ink} lw={lw} />{tag}</>;
}

export default function Stamp({ spec, label, initial = "", ink = CANON.cream, scale = 1, sealed = false, rewatch = false, lineWidth, style }: {
  spec: StampSpec;
  /** The tag, e.g. "S1 E2" (a "\n" stacks two words). */
  label: string;
  /** The writer's first initial, for the initial ornament. */
  initial?: string;
  ink?: string;
  scale?: number;
  sealed?: boolean;
  rewatch?: boolean;
  /** Line weight in the drawing's units. Default: 1.5 at full size — 2 read
   *  overbearing on desktop, 1.25 too faint — and 2 for a shrunk box. */
  lineWidth?: number;
  style?: React.CSSProperties;
}) {
  const f = FAM[spec.family];
  const box = stampBox(spec);
  const w = Math.round(box.w * scale), h = Math.round(box.h * scale);
  const lw = lineWidth ?? (scale < 1 ? 2 : 1.5);
  const disc = Math.round(44 * scale);
  const extL = box.frameLeft - f.bleed, extT = box.h - f.H - 2 * f.bleed;
  const viewBox = `${-extL - f.bleed} ${-extT - f.bleed} ${box.w} ${box.h}`;
  const said = label.replace("\n", " ");
  return (
    <span role="img" aria-label={sealed ? `sealed letter, ${said}` : said} style={{ position: "relative", display: "inline-block", width: w, height: h, verticalAlign: "top", ...style }}>
      <span style={{ display: "block", width: w, height: h, transform: spec.tilt ? `rotate(${spec.tilt}deg)` : undefined, transformOrigin: "center" }}>
        <svg width={w} height={h} viewBox={viewBox} aria-hidden style={{ display: "block", overflow: "visible" }}>
          <Drawing spec={spec} label={label} initial={initial} ink={ink} lw={lw} />
        </svg>
      </span>
      {rewatch && (
        <HatGlasses size={Math.round(15 * scale)} color={CANON.alert} aria-hidden style={{ position: "absolute", left: Math.round((box.frameLeft + 4) * scale), bottom: Math.round((box.frameBottom + 2) * scale) }} />
      )}
      {sealed && (
        <span aria-hidden style={{ position: "absolute", left: Math.round(box.frameLeft * scale) - disc / 2, top: "50%", transform: "translateY(-50%)", width: disc, height: disc, borderRadius: "50%", background: CANON.alert, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Lock size={Math.round(20 * scale)} color={CANON.cream} strokeWidth={2.4} />
        </span>
      )}
    </span>
  );
}
