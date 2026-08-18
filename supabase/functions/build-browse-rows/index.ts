// ============================================================
// Supabase Edge Function: build-browse-rows
//
// Rebuilds the group room's two AUTO poster rows from TVMaze and writes them
// to public.browse_shows (2026-08-17 browse-rows arc, CP1):
//
//   starting_up — season premieres + series premieres in a window of 7 days
//                 back → 30 days ahead, ordered by distance from today
//                 (yesterday's premiere sits ahead of one three weeks out).
//   popular     — shows with an episode airing ±14 days from today, ranked by
//                 TVMaze's `weight` popularity score (0–100), minus anything
//                 already in starting_up. Ties → most recent airing → name.
//
// Filters (Alborz 2026-08-16, "fiction only for now"):
//   • show.type Scripted or Animation, language English
//   • network OR streamer on the CHANNELS shortlist (matched by name)
//   • no "Children" genre
//   • not a daily/soap: season > 100 (year-numbered) or episode number > 60
//   • regular episodes only (no specials)
//
// Sources: TVMaze's per-day schedules — `/schedule/web?date=` (streaming,
// NO country filter: Netflix/HBO Max/Paramount+ are "global" on TVMaze and
// vanish under ?country=US — verified 2026-08-17) + `/schedule?country=US`
// (broadcast + cable). 38 days × 2 = 76 calls, PACED (~550ms) under TVMaze's
// ~20 req/10s limit → ~45s per run. Runs nightly via pg_cron
// (run_build_browse_rows, 20260817_browse_rows.sql).
//
// Writes: rows are inserted with this run's computed_at, then anything older
// is deleted — the row is never empty mid-run. Up to KEEP per row so the
// client can hide a group's own shows and still fill 10.
//
// Invocation (NOT user-facing — cron + manual testing only):
//   POST  Header: x-digest-secret: <DIGEST_CRON_SECRET>   (shared with digests)
//   Body (optional): { "dry_run": true } → compute + return, write nothing
//
// Environment variables required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   DIGEST_CRON_SECRET (already set for send-digests; reused deliberately)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DAYS_BACK = 7;
const DAYS_AHEAD = 30;
const POPULAR_WINDOW = 14;
const KEEP = 30;              // candidates stored per row (client shows 10 after exclusions)
const PACE_MS = 550;          // TVMaze: ~20 requests / 10 seconds

// Network + streamer shortlist (lower-cased TVMaze names). Alborz 2026-08-16:
// prestige streamers/cable + the big four; Adult Swim / Comedy Central / TNT /
// Syfy / MGM+ added 2026-08-17 after the schedule probe (Rick and Morty,
// South Park, etc. live there). Kids' channels deliberately absent.
const CHANNELS = new Set([
  "hbo", "hbo max", "max", "netflix", "apple tv+", "apple tv", "prime video",
  "amazon prime video", "disney+", "hulu", "fx", "fxx", "amc", "amc+",
  "showtime", "paramount+", "paramount+ with showtime", "peacock",
  "bbc one", "bbc two", "bbc three", "bbc america", "bbc iplayer",
  "abc", "nbc", "cbs", "fox", "starz", "the cw",
  "adult swim", "comedy central", "tnt", "syfy", "mgm+",
]);

type TvShow = {
  id: number; name: string; type?: string; language?: string; genres?: string[];
  weight?: number; premiered?: string | null; status?: string;
  network?: { name: string } | null; webChannel?: { name: string } | null;
  image?: { medium?: string; original?: string } | null;
};
type TvEpisode = {
  season?: number; number?: number | null; type?: string; airdate?: string;
  show?: TvShow; _embedded?: { show?: TvShow };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const channelOf = (s: TvShow) => (s.network?.name ?? s.webChannel?.name ?? "");

function passes(s: TvShow, ep: TvEpisode): boolean {
  if (s.type !== "Scripted" && s.type !== "Animation") return false;
  if (s.language !== "English") return false;
  if (!CHANNELS.has(channelOf(s).toLowerCase())) return false;
  if ((s.genres ?? []).includes("Children")) return false;
  if ((ep.season ?? 0) > 100 || (ep.number ?? 0) > 60) return false;
  if (ep.type && ep.type !== "regular") return false;
  return true;
}

async function fetchDay(url: string): Promise<TvEpisode[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return (await res.json()) as TvEpisode[];
  } catch {
    return [];
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("DIGEST_CRON_SECRET");
  const provided = req.headers.get("x-digest-secret");
  if (!secret || provided !== secret) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean };
  const dryRun = !!body.dry_run;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dayMs = 24 * 3600 * 1000;

  // ── Walk the window ───────────────────────────────────────────────────────
  type Cand = { show: TvShow; ep: TvEpisode; date: string; offset: number };
  const cands: Cand[] = [];
  let calls = 0;
  for (let off = -DAYS_BACK; off <= DAYS_AHEAD; off++) {
    const date = isoDate(new Date(today.getTime() + off * dayMs));
    const web = await fetchDay(`https://api.tvmaze.com/schedule/web?date=${date}`);
    calls++;
    await sleep(PACE_MS);
    const net = await fetchDay(`https://api.tvmaze.com/schedule?country=US&date=${date}`);
    calls++;
    await sleep(PACE_MS);
    for (const ep of [...web, ...net]) {
      const show = ep._embedded?.show ?? ep.show;
      if (!show || !passes(show, ep)) continue;
      cands.push({ show, ep, date, offset: off });
    }
  }

  // ── starting_up: first episode of a season, nearest-to-today first ───────
  const starting = new Map<number, Cand>();
  for (const c of cands) {
    if (c.ep.number !== 1) continue;
    const prev = starting.get(c.show.id);
    if (!prev || Math.abs(c.offset) < Math.abs(prev.offset)) starting.set(c.show.id, c);
  }
  const startingRows = [...starting.values()]
    .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset) || a.offset - b.offset || (b.show.weight ?? 0) - (a.show.weight ?? 0))
    .slice(0, KEEP)
    .map((c, i) => ({
      row_key: "starting_up",
      tvmaze_id: c.show.id,
      rank: i,
      name: c.show.name,
      image_url: c.show.image?.medium ?? c.show.image?.original ?? null,
      channel: channelOf(c.show) || null,
      kind: (c.ep.season ?? 1) <= 1 ? "premiere" : "returns",
      season: c.ep.season ?? null,
      air_date: c.date,
      weight: c.show.weight ?? null,
    }));

  // ── popular: airing ±POPULAR_WINDOW days, by weight, minus starting_up ────
  const popular = new Map<number, Cand>();
  for (const c of cands) {
    if (Math.abs(c.offset) > POPULAR_WINDOW) continue;
    if (starting.has(c.show.id)) continue;
    const prev = popular.get(c.show.id);
    // Keep the most RECENT airing as the tiebreak date.
    if (!prev || (c.offset <= 0 && c.offset > prev.offset) || (prev.offset > 0 && c.offset < prev.offset)) popular.set(c.show.id, c);
  }
  const popularRows = [...popular.values()]
    .sort((a, b) => (b.show.weight ?? 0) - (a.show.weight ?? 0) || Math.abs(a.offset) - Math.abs(b.offset) || a.show.name.localeCompare(b.show.name))
    .slice(0, KEEP)
    .map((c, i) => ({
      row_key: "popular",
      tvmaze_id: c.show.id,
      rank: i,
      name: c.show.name,
      image_url: c.show.image?.medium ?? c.show.image?.original ?? null,
      channel: channelOf(c.show) || null,
      kind: null,
      season: c.ep.season ?? null,
      air_date: c.date,
      weight: c.show.weight ?? null,
    }));

  const summary = {
    calls,
    candidates: cands.length,
    starting_up: startingRows.map((r) => `${r.air_date} ${r.kind} S${r.season} ${r.name} (${r.channel})`),
    popular: popularRows.map((r) => `w${r.weight} ${r.name} (${r.channel})`),
  };
  if (dryRun) return json({ dry_run: true, ...summary });

  // ── Write: insert this run, then drop older rows (never empty mid-run) ───
  // A dry TVMaze day (outage) would otherwise wipe the rows: refuse to write
  // when the walk came back essentially empty.
  if (startingRows.length + popularRows.length < 5) {
    return json({ error: "too_few_rows_refusing_to_overwrite", ...summary }, 500);
  }
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const computedAt = new Date().toISOString();
  const rows = [...startingRows, ...popularRows].map((r) => ({ ...r, computed_at: computedAt }));
  const { error: upErr } = await admin.from("browse_shows").upsert(rows, { onConflict: "row_key,tvmaze_id" });
  if (upErr) return json({ error: "upsert_failed", detail: upErr.message }, 500);
  const { error: delErr } = await admin.from("browse_shows").delete().lt("computed_at", computedAt);
  if (delErr) return json({ error: "cleanup_failed", detail: delErr.message }, 500);

  return json({ ok: true, computed_at: computedAt, ...summary });
});
