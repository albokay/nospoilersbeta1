// Treated-art generator — local pre-warm script.
//
// Generates cutout-plus-tint PNGs for shows in the catalog and uploads
// them to the Supabase Storage public bucket "treated-art", keyed by
// `${showId}-${color}.png`. The frontend <TreatedArt /> component reads
// from those URLs directly; nothing on Vercel runs this pipeline.
//
// Usage:
//   npm run treated-art:generate                       — all shows × all canon colors
//   npm run treated-art:generate -- --show peakyblinders
//   npm run treated-art:generate -- --color cream
//   npm run treated-art:generate -- --show peakyblinders --color cream
//   npm run treated-art:generate -- --force            — overwrite cached entries
//
// Requires in `.env.local`:
//   VITE_SUPABASE_URL=https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=<service-role key from Supabase dashboard>
//
// The service-role key bypasses RLS and is dangerous — keep it in
// .env.local (which is gitignored) and never in source / Vercel / shared
// terminals. The client-side `VITE_SUPABASE_ANON_KEY` already in
// .env.local is irrelevant to this script; we need the service role to
// write to Storage.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";

// Canon palette — keep in sync with theme.ts canon hexes and the
// client-side src/lib/treatedArt.ts color list. "cream" = canon white.
const CANON_PALETTE: Record<string, string> = {
  red:          "#f45028",
  yellow:       "#dea838",
  green:        "#7abd8e",
  "dark-blue":  "#355eb8",
  "light-blue": "#adc8d7",
  cream:        "#fffaf0",
};
const ALL_COLORS = Object.keys(CANON_PALETTE);

const STORAGE_BUCKET = "treated-art";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

type Args = {
  show?: string;
  color?: string;
  force: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--show" && argv[i + 1]) { out.show = argv[++i]; continue; }
    if (a === "--color" && argv[i + 1]) { out.color = argv[++i]; continue; }
    if (a === "--force") { out.force = true; continue; }
  }
  return out;
}

// supabase client typed loosely — ReturnType<typeof createClient> resolves
// to the library's default generics (never), but createClient(url, key)
// (without explicit Database types) infers a concrete public-schema
// client. `any` here is the pragmatic fit for a one-off script.
async function generateOne(
  supabase: any,
  showId: string,
  tvmazeId: number,
  color: string,
  force: boolean
): Promise<{ status: "ok" | "cached" | "skipped" | "failed"; detail?: string }> {
  const objectKey = `${showId}-${color}.png`;

  // Idempotency check unless --force.
  if (!force) {
    const { data: existing } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list("", { search: objectKey, limit: 1 });
    if (existing?.some((o: { name: string }) => o.name === objectKey)) {
      return { status: "cached" };
    }
  }

  // 1. Fetch TVMaze record.
  const tvmazeRes = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}`);
  if (!tvmazeRes.ok) {
    return { status: "failed", detail: `tvmaze ${tvmazeRes.status}` };
  }
  const tvmaze = (await tvmazeRes.json()) as { image?: { original?: string; medium?: string } };
  const imageUrl = tvmaze.image?.original || tvmaze.image?.medium;
  if (!imageUrl) {
    return { status: "skipped", detail: "no source image on tvmaze" };
  }

  // 2. Download source.
  const srcRes = await fetch(imageUrl);
  if (!srcRes.ok) {
    return { status: "failed", detail: `source fetch ${srcRes.status}` };
  }
  const srcBuf = Buffer.from(await srcRes.arrayBuffer());

  // 3. Background removal. First call per process downloads the ONNX
  //    model (~80MB medium variant) to a temp dir; subsequent calls in
  //    the same process reuse it.
  const cutoutBlob = await removeBackground(srcBuf, {
    model: "medium",
    output: { format: "image/png" },
  });
  const cutoutBuf = Buffer.from(await cutoutBlob.arrayBuffer());

  // 4. Monochrome tint. sharp.tint() applies a single color across the
  //    full luminance range; greyscale() first removes source hue so
  //    the tint maps purely from luminance.
  const { r, g, b } = hexToRgb(CANON_PALETTE[color]);
  const tintedBuf = await sharp(cutoutBuf)
    .ensureAlpha()
    .greyscale()
    .tint({ r, g, b })
    .png({ compressionLevel: 9 })
    .toBuffer();

  // 5. Upload.
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectKey, tintedBuf, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "31536000",
    });
  if (upErr) {
    return { status: "failed", detail: `upload: ${upErr.message}` };
  }

  return { status: "ok", detail: `${tintedBuf.length} bytes` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "Missing env. Set in .env.local:\n" +
        "  VITE_SUPABASE_URL=https://<project>.supabase.co  (already present for the live app)\n" +
        "  SUPABASE_SERVICE_ROLE_KEY=<service-role key from Supabase dashboard → Settings → API>\n"
    );
    process.exit(1);
  }

  if (args.color && !CANON_PALETTE[args.color]) {
    console.error(`Unknown color "${args.color}". Valid: ${ALL_COLORS.join(", ")}`);
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Fetch shows that have a tvmaze_id (no point trying on shows without
  // a source image). Filter by --show if provided.
  let query = supabase.from("shows").select("id, name, tvmaze_id").not("tvmaze_id", "is", null);
  if (args.show) query = query.eq("id", args.show);

  const { data: shows, error: showsErr } = await query;
  if (showsErr) {
    console.error("Failed to fetch shows:", showsErr.message);
    process.exit(1);
  }
  if (!shows || shows.length === 0) {
    console.error(args.show ? `Show "${args.show}" not found (or has no tvmaze_id).` : "No shows with tvmaze_id in catalog.");
    process.exit(1);
  }

  const colors = args.color ? [args.color] : ALL_COLORS;
  const total = shows.length * colors.length;
  let done = 0;
  let ok = 0;
  let cached = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`Generating treated art for ${shows.length} show(s) × ${colors.length} color(s) = ${total} combos.`);
  console.log(args.force ? "Force mode: regenerating all (cache ignored)." : "Cached entries will be skipped.");
  console.log("");

  for (const show of shows) {
    for (const color of colors) {
      done++;
      const showId = show.id as string;
      const tvmazeId = show.tvmaze_id as number;
      const label = `[${done}/${total}] ${showId} × ${color}`;
      process.stdout.write(`${label} … `);
      const start = Date.now();
      try {
        const r = await generateOne(supabase, showId, tvmazeId, color, args.force);
        const took = ((Date.now() - start) / 1000).toFixed(1);
        if (r.status === "ok") { ok++; console.log(`generated (${took}s, ${r.detail})`); }
        else if (r.status === "cached") { cached++; console.log("cached"); }
        else if (r.status === "skipped") { skipped++; console.log(`skipped (${r.detail})`); }
        else { failed++; console.log(`FAILED (${took}s, ${r.detail})`); }
      } catch (err) {
        failed++;
        const took = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`FAILED (${took}s, ${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }

  console.log("");
  console.log(`Done. ok=${ok} cached=${cached} skipped=${skipped} failed=${failed}`);
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
