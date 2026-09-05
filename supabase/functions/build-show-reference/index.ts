// ============================================================
// build-show-reference — assemble + cache a show's SPOILER-SAFE reference
// index (the spoiler-gated reference arc, CP0, 2026-09-05).
//
// One JSON blob per show in public.show_reference, built the first time any
// signed-in user opens the show's reference tab and reused by everyone at
// every progress (the CLIENT filters by the viewer's own episode — safe for
// the same reason the audit downgraded M1: the only person this data could
// spoil is the viewer).
//
// SAFETY RULES (the whole point — do not "optimize" these away):
//   • NEVER TMDB aggregate credits — they carry episode counts ("14
//     episodes" = the character survives). People are assembled from
//     per-season regular cast + per-episode guest stars only.
//   • A person's entry uses the character name AS CREDITED AT FIRST
//     APPEARANCE (credits-as-aired are safe; later names can be twists).
//   • Per-season trailer keys only — a show-level video list mixes in
//     finale promos. The launch trailer uses the earliest-official rule
//     ported from src/lib/trailers.ts.
//   • Episode summaries come from TVMaze (pre-air editorial voice), HTML
//     stripped.
//
// Bridge: shows.tvmaze_id → TVMaze externals (imdb → thetvdb) → TMDB /find.
// No name search, so the wrong show can't resolve (trailers-spec rule).
//
// Cache policy: rebuilt when stale — running shows after 24h, ended shows
// after 30d (metadata corrections); otherwise the cached blob is returned
// untouched. A build is ~2 + seasons TMDB calls + 2 TVMaze calls.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto), TMDB_READ_TOKEN
// (manual: `supabase secrets set TMDB_READ_TOKEN=<the Vercel
// VITE_TMDB_READ_TOKEN value>`). Add `verify_jwt = false` in config.toml —
// this function verifies the caller's JWT itself (ES256 keys, the
// send-group-invite pattern).
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://beta.sidebar.watch",
  "http://localhost:5173",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://beta.sidebar.watch";
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary":                         "Origin",
  };
}

const TMDB_BASE = "https://api.themoviedb.org/3";
const TVMAZE_BASE = "https://api.tvmaze.com";

type RefEpisode = {
  s: number; e: number; title: string;
  airDate: string | null; summary: string | null;
  writers: string[]; directors: string[]; dp: string[];
};
type RefPerson = {
  name: string; character: string | null;
  firstS: number; firstE: number;
  /** true = exact first episode known (guest credit); false = season-level
   *  (series regular for that season — rendered "since season N"). */
  exact: boolean;
  img: string | null;
};
type RefSeason = { n: number; trailerKey: string | null; episodes: RefEpisode[] };
type RefData = {
  builtAt: string;
  showName: string;
  createdBy: string[];
  launchTrailerKey: string | null;
  seasons: RefSeason[];
  people: RefPerson[];
};

function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || null;
}

// Earliest-published official YouTube Trailer, else Teaser (trailers.ts rule).
function pickTrailerKey(results: any[]): string | null {
  const earliestOfType = (type: string): string | null => {
    const vids = (results ?? []).filter(
      (v) => v?.site === "YouTube" && v?.official === true && v?.type === type,
    );
    if (!vids.length) return null;
    vids.sort((a, b) =>
      (a.published_at ? Date.parse(a.published_at) : Infinity) -
      (b.published_at ? Date.parse(b.published_at) : Infinity));
    return vids[0].key ?? null;
  };
  return earliestOfType("Trailer") ?? earliestOfType("Teaser");
}

async function tmdbGet(path: string, token: string): Promise<any | null> {
  try {
    const res = await fetch(`${TMDB_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// tvmazeId → TMDB tv id via externals (imdb preferred, then thetvdb).
async function resolveTmdbTvId(tvmazeId: string, token: string): Promise<number | null> {
  try {
    const res = await fetch(`${TVMAZE_BASE}/shows/${encodeURIComponent(tvmazeId)}`);
    if (!res.ok) return null;
    const externals = (await res.json())?.externals ?? {};
    const attempts: Array<{ id: string; source: string }> = [];
    if (externals.imdb) attempts.push({ id: String(externals.imdb), source: "imdb_id" });
    if (externals.thetvdb) attempts.push({ id: String(externals.thetvdb), source: "tvdb_id" });
    for (const { id, source } of attempts) {
      const data = await tmdbGet(`/find/${encodeURIComponent(id)}?external_source=${source}`, token);
      const tvId = data?.tv_results?.[0]?.id;
      if (typeof tvId === "number") return tvId;
    }
  } catch { /* fall through */ }
  return null;
}

function crewNames(crew: any[], jobs: string[]): string[] {
  const out: string[] = [];
  for (const c of crew ?? []) {
    if (jobs.includes(c?.job) && c?.name && !out.includes(c.name)) out.push(c.name);
  }
  return out;
}

const epIndex = (s: number, e: number) => s * 10000 + e;

async function buildReference(
  tvmazeId: string, showName: string, token: string,
): Promise<RefData | null> {
  // ── TVMaze: the episode skeleton (numbers, titles, air dates, summaries) ──
  const tvmRes = await fetch(`${TVMAZE_BASE}/shows/${encodeURIComponent(tvmazeId)}/episodes`);
  if (!tvmRes.ok) return null;
  const tvmEpisodes: any[] = await tvmRes.json();
  const bySeason = new Map<number, RefEpisode[]>();
  for (const ep of tvmEpisodes ?? []) {
    const s = ep?.season, e = ep?.number;
    if (typeof s !== "number" || typeof e !== "number" || s < 1 || e < 1) continue; // specials skipped
    if (!bySeason.has(s)) bySeason.set(s, []);
    bySeason.get(s)!.push({
      s, e,
      title: ep?.name ?? `Episode ${e}`,
      airDate: ep?.airdate || null,
      summary: stripHtml(ep?.summary),
      writers: [], directors: [], dp: [],
    });
  }
  if (bySeason.size === 0) return null;

  const seasons: RefSeason[] = [...bySeason.keys()].sort((a, b) => a - b)
    .map((n) => ({ n, trailerKey: null, episodes: bySeason.get(n)!.sort((a, b) => a.e - b.e) }));

  const data: RefData = {
    builtAt: new Date().toISOString(),
    showName,
    createdBy: [],
    launchTrailerKey: null,
    seasons,
    people: [],
  };

  // ── TMDB enrichment (tolerant — a bridge miss still ships the episode list) ──
  const tmdbId = await resolveTmdbTvId(tvmazeId, token);
  if (tmdbId == null) return data;

  const showDetail = await tmdbGet(`/tv/${tmdbId}?append_to_response=videos`, token);
  data.createdBy = (showDetail?.created_by ?? []).map((c: any) => c?.name).filter(Boolean);
  data.launchTrailerKey = pickTrailerKey(showDetail?.videos?.results ?? []);

  // People, first-appearance-first. Two safe sources per season:
  //   season detail episodes[].guest_stars (exact first episode) and
  //   season credits cast (regulars — season-level, exact:false).
  const people = new Map<string, RefPerson>();
  const noteAppearance = (
    name: string | undefined, character: string | undefined, img: string | undefined,
    s: number, e: number, exact: boolean,
  ) => {
    if (!name) return;
    const prev = people.get(name);
    const idx = epIndex(s, e);
    if (!prev) {
      people.set(name, {
        name, character: character?.trim() || null,
        firstS: s, firstE: e, exact, img: img || null,
      });
      return;
    }
    // Keep the EARLIEST sighting; an exact guest credit beats a same-point
    // season-level one, and the first-credited character name sticks.
    const prevIdx = epIndex(prev.firstS, prev.firstE);
    if (idx < prevIdx || (idx === prevIdx && exact && !prev.exact)) {
      prev.firstS = s; prev.firstE = e; prev.exact = exact;
      if (idx < prevIdx && character?.trim()) prev.character = character.trim();
    }
    if (!prev.img && img) prev.img = img;
  };

  for (const season of seasons) {
    const sd = await tmdbGet(`/tv/${tmdbId}/season/${season.n}?append_to_response=credits,videos`, token);
    if (!sd) continue;
    season.trailerKey = pickTrailerKey(sd?.videos?.results ?? []);
    // Season regulars — credited for the season, first known at S{n} (not
    // an exact episode; rendered "since season N" and gated at S{n}E1).
    for (const c of sd?.credits?.cast ?? []) {
      noteAppearance(c?.name, c?.character, c?.profile_path, season.n, 1, false);
    }
    for (const ep of sd?.episodes ?? []) {
      const e = ep?.episode_number;
      const target = typeof e === "number" ? season.episodes.find((x) => x.e === e) : undefined;
      if (target) {
        target.writers = crewNames(ep?.crew, ["Writer", "Teleplay", "Story"]);
        target.directors = crewNames(ep?.crew, ["Director"]);
        target.dp = crewNames(ep?.crew, ["Director of Photography"]);
        if (!target.summary) target.summary = stripHtml(ep?.overview);
      }
      if (typeof e === "number") {
        for (const g of ep?.guest_stars ?? []) {
          noteAppearance(g?.name, g?.character, g?.profile_path, season.n, e, true);
        }
      }
    }
  }
  data.people = [...people.values()].sort(
    (a, b) => epIndex(a.firstS, a.firstE) - epIndex(b.firstS, b.firstE) || a.name.localeCompare(b.name));
  return data;
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const jsonOk = (body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: true, ...body }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  const jsonError = (code: string, status: number, message?: string) =>
    new Response(JSON.stringify({ ok: false, error: code, ...(message ? { message } : {}) }), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("missing_auth", 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !user) return jsonError("unauthorized", 401);

    const body = await req.json().catch(() => null);
    const showId = typeof body?.show_id === "string" ? body.show_id : null;
    if (!showId) return jsonError("invalid_body", 400);

    const { data: show } = await admin
      .from("shows")
      .select("id, name, tvmaze_id, status")
      .eq("id", showId)
      .maybeSingle();
    if (!show) return jsonError("show_not_found", 404);
    if (!show.tvmaze_id) return jsonError("no_tvmaze_id", 422);

    // Cache check — fresh blobs return untouched.
    const { data: cached } = await admin
      .from("show_reference")
      .select("data, fetched_at")
      .eq("show_id", showId)
      .maybeSingle();
    if (cached?.data && cached.fetched_at) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
      const maxAge = (show.status === "Ended" ? 30 : 1) * 24 * 60 * 60 * 1000;
      if (ageMs < maxAge) return jsonOk({ data: cached.data, cached: true });
    }

    const token = Deno.env.get("TMDB_READ_TOKEN");
    if (!token) {
      // Misconfigured secret: serve a stale blob if one exists (better than
      // nothing), else fail visibly.
      if (cached?.data) return jsonOk({ data: cached.data, cached: true, warning: "tmdb_not_configured" });
      return jsonError("tmdb_not_configured", 500);
    }

    const built = await buildReference(String(show.tvmaze_id), show.name, token);
    if (!built) {
      if (cached?.data) return jsonOk({ data: cached.data, cached: true, warning: "build_failed" });
      return jsonError("build_failed", 502);
    }

    const { error: upsertErr } = await admin
      .from("show_reference")
      .upsert({ show_id: showId, data: built, fetched_at: new Date().toISOString() });
    if (upsertErr) console.error("[build-show-reference] cache write failed:", upsertErr.message);

    return jsonOk({ data: built, cached: false });
  } catch (e) {
    console.error("[build-show-reference] unexpected:", e);
    return jsonError("internal", 500);
  }
});
