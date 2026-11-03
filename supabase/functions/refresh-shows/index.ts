// refresh-shows — the nightly episode-list refresh (2026-11-02; his Survivor
// catch: a show nobody holds in a pool went stale for weeks, and the picker
// offered one episode of a season with six aired).
//
// Every show that isn't Ended (Running, In Development, To Be Determined —
// the ones that can change) gets today's counts from TVMaze: the aired
// episodes per season (shows.seasons — what every picker reads), what
// TVMaze lists per season, the next unaired episode, genres, type and
// status — the SAME computation as the client's refreshShowIfStale, so a
// page-load refresh and the nightly one can never disagree. Ended shows are
// left alone (nothing changes); a client refresh still covers them on the
// 12-hour cadence if they ever un-end.
//
// Cost: about 70 shows × 2 small TVMaze reads × 1 row update, once a day.
//
// + THE BACKDROPS (the landing-rule arc's CP5, 2026-11-02): a second pass over
// shows with no backdrop_url yet (Ended ones too, up to 100 a night) resolves
// the show's TMDB backdrop through the trailers bridge (externals → /find →
// /tv/{id}/images, a TEXTLESS one first) and stores its w1280 URL for the
// phone room's banner. A miss
// stays NULL and is tried again the next night. Needs TMDB_READ_TOKEN (the
// secret build-show-reference already uses); without it the pass is skipped.
//
// Auth: the shared cron secret (x-digest-secret = DIGEST_CRON_SECRET), as
// send-digests and build-browse-rows — called by pg_cron (run_refresh_shows)
// or by hand. Body: { dry_run?: boolean, only_show_id?: string, all?: boolean }
// (all = Ended shows too, for a one-off catch-up).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

type ShowRow = { id: string; tvmaze_id: string | number | null; status: string | null; genres: string[] | null; tvmaze_type: string | null; last_synced_at: string | null };

async function refreshOne(admin: any, show: ShowRow, dryRun: boolean): Promise<{ id: string; ok: boolean; seasons?: number[]; reason?: string }> {
  if (!show.tvmaze_id) return { id: show.id, ok: false, reason: "no_tvmaze_id" };
  const [showRes, epRes] = await Promise.all([
    fetch(`https://api.tvmaze.com/shows/${show.tvmaze_id}`),
    fetch(`https://api.tvmaze.com/shows/${show.tvmaze_id}/episodes`),
  ]);
  if (!epRes.ok) return { id: show.id, ok: false, reason: `episodes_${epRes.status}` };
  const episodes: any[] = await epRes.json();
  const nowIso = new Date().toISOString();
  const bySeason: Record<number, number> = {};
  const plannedBySeason: Record<number, number> = {};
  let nextAir: { at: string; season: number } | null = null;
  for (const ep of episodes) {
    const isRegular = ep.type === "regular" || !ep.type;
    const hasAired = typeof ep.airstamp === "string" && ep.airstamp <= nowIso;
    if (isRegular && hasAired) bySeason[ep.season] = (bySeason[ep.season] ?? 0) + 1;
    if (isRegular && typeof ep.season === "number") {
      plannedBySeason[ep.season] = (plannedBySeason[ep.season] ?? 0) + 1;
      if (typeof ep.airstamp === "string" && ep.airstamp > nowIso && (!nextAir || ep.airstamp < nextAir.at)) nextAir = { at: ep.airstamp, season: ep.season };
    }
  }
  const seasonKeys = Object.keys(bySeason).map(Number);
  const maxSeason = seasonKeys.length ? Math.max(...seasonKeys) : 0;
  const seasons: number[] = [];
  for (let i = 1; i <= maxSeason; i++) seasons.push(bySeason[i] ?? 0);
  const plannedKeys = Object.keys(plannedBySeason).map(Number);
  const maxPlanned = plannedKeys.length ? Math.max(...plannedKeys) : 0;
  const seasonsPlanned: number[] = [];
  for (let i = 1; i <= maxPlanned; i++) seasonsPlanned.push(plannedBySeason[i] ?? 0);

  let genres: string[] = show.genres ?? [];
  let tvmazeType: string | null = show.tvmaze_type ?? null;
  let tvmazeStatus: string | undefined;
  if (showRes.ok) {
    const showData = await showRes.json();
    if (Array.isArray(showData.genres)) genres = showData.genres;
    if (showData.type) tvmazeType = showData.type;
    if (showData.status) tvmazeStatus = showData.status;
  }
  const normalizedStatus = tvmazeStatus ? (tvmazeStatus === "Running" ? "Running" : "Ended") : (show.status ?? "Ended");

  if (dryRun) return { id: show.id, ok: true, seasons };
  const { error } = await admin
    .from("shows")
    .update({
      seasons, last_synced_at: nowIso, genres, tvmaze_type: tvmazeType, status: normalizedStatus,
      seasons_planned: seasonsPlanned, next_air_at: nextAir?.at ?? null, next_air_season: nextAir?.season ?? null,
    })
    .eq("id", show.id);
  if (error) return { id: show.id, ok: false, reason: error.message };
  return { id: show.id, ok: true, seasons };
}

const TMDB_BASE = "https://api.themoviedb.org/3";
async function tmdbGet(path: string, token: string): Promise<any | null> {
  try {
    const res = await fetch(`${TMDB_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
// tvmaze_id → TVMaze externals (imdb, then thetvdb) → TMDB tv id → backdrop_path. No name search.
async function resolveBackdropUrl(tvmazeId: string | number, token: string): Promise<string | null> {
  let externals: { imdb?: string | null; thetvdb?: number | string | null } = {};
  try {
    const res = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}`);
    if (res.ok) externals = (await res.json())?.externals ?? {};
  } catch { /* no bridge */ }
  const attempts: Array<{ id: string; source: string }> = [];
  if (externals.imdb) attempts.push({ id: String(externals.imdb), source: "imdb_id" });
  if (externals.thetvdb) attempts.push({ id: String(externals.thetvdb), source: "tvdb_id" });
  let tvId: number | null = null;
  for (const { id, source } of attempts) {
    const data = await tmdbGet(`/find/${encodeURIComponent(id)}?external_source=${source}`, token);
    const found = data?.tv_results?.[0]?.id;
    if (typeof found === "number") { tvId = found; break; }
  }
  if (tvId == null) return null;
  // Textless first (his note, 11-02): TMDB files a backdrop with no title
  // text under no language; one with English text is next; the show's
  // primary backdrop is the last resort.
  const imgs = await tmdbGet(`/tv/${tvId}/images?include_image_language=null,en`, token);
  const backs: any[] = Array.isArray(imgs?.backdrops) ? imgs.backdrops : [];
  const by = (lang: string | null) => backs.filter((b) => (b?.iso_639_1 ?? null) === lang && typeof b?.file_path === "string").sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0));
  const pick = by(null)[0] ?? by("en")[0];
  if (pick) return `https://image.tmdb.org/t/p/w1280${pick.file_path}`;
  const tv = await tmdbGet(`/tv/${tvId}`, token);
  const path = tv?.backdrop_path;
  return typeof path === "string" && path ? `https://image.tmdb.org/t/p/w1280${path}` : null;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("DIGEST_CRON_SECRET");
  const provided = req.headers.get("x-digest-secret");
  if (!secret || provided !== secret) return json({ error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean; only_show_id?: string; all?: boolean };
  const dryRun = !!body.dry_run;

  let q = admin.from("shows").select("id, tvmaze_id, status, genres, tvmaze_type, last_synced_at").not("tvmaze_id", "is", null);
  if (body.only_show_id) q = q.eq("id", body.only_show_id);
  else if (!body.all) q = q.neq("status", "Ended");
  const { data: rows, error } = await q;
  if (error) return json({ error: "shows_query_failed", detail: error.message }, 500);
  const shows = (rows ?? []) as ShowRow[];

  // Gentle on TVMaze: four at a time (two reads each).
  const results: { id: string; ok: boolean; seasons?: number[]; reason?: string }[] = [];
  let next = 0;
  async function worker() {
    while (next < shows.length) {
      const s = shows[next++];
      try { results.push(await refreshOne(admin, s, dryRun)); }
      catch (e) { results.push({ id: s.id, ok: false, reason: String(e) }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, shows.length) }, worker));
  const refreshed = results.filter((r) => r.ok).length;

  // The backdrops pass (CP5): shows with no landscape art yet, any status.
  const backdrops: { tried: number; filled: number; skipped?: string } = { tried: 0, filled: 0 };
  const tmdbToken = Deno.env.get("TMDB_READ_TOKEN");
  if (!tmdbToken) backdrops.skipped = "no_tmdb_token";
  else {
    let bq = admin.from("shows").select("id, tvmaze_id").is("backdrop_url", null).not("tvmaze_id", "is", null).limit(100);
    if (body.only_show_id) bq = admin.from("shows").select("id, tvmaze_id").eq("id", body.only_show_id).not("tvmaze_id", "is", null);
    const { data: bare } = await bq;
    const todo = (bare ?? []) as { id: string; tvmaze_id: string | number }[];
    let bi = 0;
    async function bworker() {
      while (bi < todo.length) {
        const s = todo[bi++];
        backdrops.tried += 1;
        try {
          const url = await resolveBackdropUrl(s.tvmaze_id, tmdbToken!);
          if (!url || dryRun) continue;
          const { error: be } = await admin.from("shows").update({ backdrop_url: url }).eq("id", s.id);
          if (!be) backdrops.filled += 1;
        } catch { /* next night */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, todo.length) }, bworker));
  }
  return json({ ok: true, dryRun, candidates: shows.length, refreshed, failed: results.filter((r) => !r.ok), backdrops });
});
