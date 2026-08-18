// One-off (re-runnable): renders the home-screen app icons from the logo's
// block mark (SidebarLogo ARRANGEMENTS[1], no wordmark — unreadable at icon
// size) on canon green. Run: node scripts/generate-app-icons.mjs
// Outputs public/icons/{icon-192,icon-512,icon-512-maskable,apple-touch-icon}.png
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const GREEN = "#7ABD8E", ACCENT = "#DEA838", CREAM = "#FEF8EA", SKY = "#ADC8D7", ALERT = "#F45028", IDENTITY = "#355EB8";
// Arrangement 1 from SidebarLogo.tsx (52px blocks, radius 15), cluster bbox ≈ 280×137.
const blocks = [
  { c: ACCENT,   x: -8,  y: 90 }, // "green" (accent yellow) — lower-left
  { c: CREAM,    x: 65,  y: 8  }, // white — upper-left of cluster
  { c: SKY,      x: 144, y: 24 }, // lightBlue — right of white/orange
  { c: ALERT,    x: 105, y: 44 }, // orange — overlapping below-right of white
  { c: IDENTITY, x: 220, y: 5  }, // blue — far upper-right
];
const minX = -8, minY = 5, bw = 272 - minX, bh = 142 - minY; // 280 × 137
function svg(size, pad) {
  const avail = size - 2 * pad;
  const s = avail / bw;
  const ox = pad, oy = (size - bh * s) / 2;
  const rects = blocks.map((b) =>
    `<rect x="${(ox + (b.x - minX) * s).toFixed(2)}" y="${(oy + (b.y - minY) * s).toFixed(2)}" width="${(52 * s).toFixed(2)}" height="${(52 * s).toFixed(2)}" rx="${(15 * s).toFixed(2)}" fill="${b.c}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${GREEN}"/>${rects}</svg>`;
}
const jobs = [
  ["icon-512.png", 512, 36],
  ["icon-512-maskable.png", 512, 92],   // safe zone: keep the mark inside the central 80%
  ["icon-192.png", 192, 14],
  ["apple-touch-icon.png", 180, 13],
];
for (const [name, size, pad] of jobs) {
  const png = await sharp(Buffer.from(svg(size, pad))).png().toBuffer();
  writeFileSync(`public/icons/${name}`, png);
  console.log("wrote", name, size);
}
