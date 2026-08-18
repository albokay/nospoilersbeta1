// Re-runnable: renders the home-screen app icons (Alborz's pass #2,
// 2026-08-18): five OPAQUE blocks in a diagonal staircase on canon green, no
// wordmark. Positions/sizes are fractions of the tile, read off the pass.
// Run: node scripts/generate-app-icons.mjs
// Outputs public/icons/{icon-192,icon-512,icon-512-maskable,apple-touch-icon}.png
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const GREEN = "#7ABD8E", ACCENT = "#DEA838", CREAM = "#FEF8EA", SKY = "#ADC8D7", ALERT = "#F45028", IDENTITY = "#355EB8";
const BLOCK = 0.288;          // block side as a fraction of the tile
const RADIUS = 15 / 52;       // the logo's corner ratio
// Paint order = z-order (later = on top): orange < yellow < cream; blue < sky.
const blocks = [
  { c: ALERT,    x: 0.060, y: 0.080 }, // orange — upper-left
  { c: ACCENT,   x: 0.265, y: 0.295 }, // yellow — over orange's lower-right
  { c: CREAM,    x: 0.430, y: 0.180 }, // cream — over yellow's upper-right
  { c: IDENTITY, x: 0.540, y: 0.670 }, // blue — lower-right, under sky
  { c: SKY,      x: 0.670, y: 0.505 }, // sky — over blue's upper-right
];

function svg(size, scale = 1) {
  // scale < 1 shrinks the composition toward the center (maskable safe zone).
  const off = (size - size * scale) / 2;
  const rects = blocks.map((b) => {
    const s = BLOCK * size * scale;
    return `<rect x="${(off + b.x * size * scale).toFixed(2)}" y="${(off + b.y * size * scale).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" rx="${(s * RADIUS).toFixed(2)}" fill="${b.c}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${GREEN}"/>${rects}</svg>`;
}
const jobs = [
  ["icon-512.png", 512, 0.84],           // breathing room from the tile edges (Alborz 2026-08-18)
  ["icon-512-maskable.png", 512, 0.78], // keep the mark inside the central 80%
  ["icon-192.png", 192, 0.84],
  ["apple-touch-icon.png", 180, 0.84],
];
for (const [name, size, scale] of jobs) {
  writeFileSync(`public/icons/${name}`, await sharp(Buffer.from(svg(size, scale))).png().toBuffer());
  console.log("wrote", name, size);
}
