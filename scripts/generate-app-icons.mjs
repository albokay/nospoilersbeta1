// Re-runnable: renders the home-screen app icons (Alborz's pass, 2026-08-18):
// SidebarLogo ARRANGEMENTS[3] with the two block clusters pulled together and
// the "sidebar" wordmark (public/sidebar-logo.png, cream) beneath, on canon
// green. Blocks OPAQUE like the site (§16). Run: node scripts/generate-app-icons.mjs
// Outputs public/icons/{icon-192,icon-512,icon-512-maskable,apple-touch-icon}.png
import sharp from "sharp";
import { writeFileSync, readFileSync } from "node:fs";

const GREEN = "#7ABD8E", ACCENT = "#DEA838", CREAM = "#FEF8EA", SKY = "#ADC8D7", ALERT = "#F45028", IDENTITY = "#355EB8";
// Arrangement 3 (52px blocks, radius 15). Left cluster as-is; the RIGHT
// cluster (lightBlue/blue at x 174/204) shifted 92px left (4px breath from the yellow) so the two clusters
// sit close, per the pass. Paint order = the logo's z: green(accent), white,
// lightBlue, orange, blue.
const SHIFT = -92;
const blocks = [
  { c: ACCENT,   x: 26,          y: 44 }, // "green" (accent yellow) — over white's lower-right
  { c: CREAM,    x: 5,           y: 13 }, // white — upper-left
  { c: SKY,      x: 174 + SHIFT, y: 36 }, // lightBlue — upper-right cluster
  { c: ALERT,    x: -11,         y: 80 }, // orange — lower-left, at text level
  { c: IDENTITY, x: 204 + SHIFT, y: 61 }, // blue — over lightBlue's lower-right
];
// z-order per the logo (accent 1, white 2, lightBlue 3, orange 4, blue 5) — the
// array above is already in that order EXCEPT white must be under accent:
const order = [1, 0, 2, 3, 4]; // white, accent, lightBlue, orange, blue
const minX = -11, minY = 13, maxX = 204 + SHIFT + 52, maxY = 80 + 52;
const bw = maxX - minX, bh = maxY - minY; // 205 × 119

const wordmark = readFileSync("public/sidebar-logo.png"); // 3108×980, cream on transparent

async function make(size, pad) {
  // Layout: blocks in the upper part, wordmark beneath; whole composition
  // vertically centered. Wordmark width ≈ 0.6 of the tile; blocks scaled so
  // the cluster is ≈ 0.62 of the tile wide.
  const clusterW = size * 0.72;
  const s = clusterW / bw;
  const clusterH = bh * s;
  const wmW = Math.round(size * 0.66);
  const wmH = Math.round(wmW * 980 / 3108);
  const gap = Math.round(size * 0.045);
  const totalH = clusterH + gap + wmH;
  const top = (size - totalH) / 2;
  const ox = (size - clusterW) / 2;
  const rects = order.map((i) => blocks[i]).map((b) =>
    `<rect x="${(ox + (b.x - minX) * s).toFixed(2)}" y="${(top + (b.y - minY) * s).toFixed(2)}" width="${(52 * s).toFixed(2)}" height="${(52 * s).toFixed(2)}" rx="${(15 * s).toFixed(2)}" fill="${b.c}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${GREEN}"/>${rects}</svg>`;
  const wm = await sharp(wordmark).resize({ width: wmW }).png().toBuffer();
  return sharp(Buffer.from(svg))
    .composite([{ input: wm, left: Math.round((size - wmW) / 2), top: Math.round(top + clusterH + gap) }])
    .png().toBuffer();
  void pad;
}
const jobs = [["icon-512.png", 512], ["icon-512-maskable.png", 512], ["icon-192.png", 192], ["apple-touch-icon.png", 180]];
for (const [name, size] of jobs) {
  writeFileSync(`public/icons/${name}`, await make(size));
  console.log("wrote", name, size);
}
