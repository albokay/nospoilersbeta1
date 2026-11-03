// Trailers — resolve a show's LAUNCH trailer (earliest official YouTube video)
// for the pre-watch opt-in modals. Spec: ~/Downloads/sidebar_trailers_spec.md.
//
// Principles baked in here:
//   • Launch trailer ONLY — earliest-published official YouTube "Trailer"
//     (Teaser fallback). NEVER a later-season trailer (spoiler safety).
//   • Bridge via external IDs ONLY (no name search → can't resolve the wrong
//     show). tvmazeId → TVMaze externals → TMDB /find → /videos.
//   • Zero Supabase egress: every hop is third-party (TVMaze + TMDB), playback
//     streams from YouTube's CDN. No DB, no Storage, no migration.
//   • Tolerant: any error / missing token / odd shape → clean miss (null),
//     never throws into the modal render path.

import { fetchTvmazeExternals } from "./tvmaze";

const TMDB_BASE = "https://api.themoviedb.org/3";

// TMDB v4 "API Read Access Token", used as a Bearer header. Client-exposed by
// design (the browser already calls TVMaze directly). Absent → silent miss
// everywhere (e.g. the Vercel env var isn't set yet).
function tmdbHeaders(): Record<string, string> | null {
  const token = import.meta.env.VITE_TMDB_READ_TOKEN as string | undefined;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

// tvmazeId → TMDB tv id, via imdb (preferred) then thetvdb. No name search.
async function resolveTmdbTvId(
  tvmazeId: number | string,
  headers: Record<string, string>,
): Promise<number | null> {
  const externals = await fetchTvmazeExternals(tvmazeId);
  if (!externals) return null;
  const attempts: Array<{ id: string; source: string }> = [];
  if (externals.imdb) attempts.push({ id: String(externals.imdb), source: "imdb_id" });
  if (externals.thetvdb) attempts.push({ id: String(externals.thetvdb), source: "tvdb_id" });
  for (const { id, source } of attempts) {
    try {
      const res = await fetch(
        `${TMDB_BASE}/find/${encodeURIComponent(id)}?external_source=${source}`,
        { headers },
      );
      if (!res.ok) continue;
      const data = await res.json();
      const tvId = data?.tv_results?.[0]?.id;
      if (typeof tvId === "number") return tvId;
    } catch {
      /* try the next external id */
    }
  }
  return null;
}

// From a /videos results[] pick the earliest official YouTube Trailer, else
// the earliest official Teaser — and, with neither (Alborz 2026-10-14, Say
// Nothing: TMDB's "official" flag is contributor-set and was off on both of
// its real trailers, so the show had none), the earliest YouTube video TMDB
// types as a Trailer, then a Teaser, flag or no flag. The earliest-published
// rule holds throughout (the launch trailer, never a later season's).
// Missing published_at sorts last (+Infinity).
function pickTrailerKey(results: any[]): string | null {
  const earliestOfType = (type: string, officialOnly: boolean): string | null => {
    const vids = (results ?? []).filter(
      (v) => v?.site === "YouTube" && (!officialOnly || v?.official === true) && v?.type === type,
    );
    vids.sort((a, b) => {
      const ta = a?.published_at ? Date.parse(a.published_at) : NaN;
      const tb = b?.published_at ? Date.parse(b.published_at) : NaN;
      return (isNaN(ta) ? Infinity : ta) - (isNaN(tb) ? Infinity : tb);
    });
    const key = vids[0]?.key;
    return typeof key === "string" && key ? key : null;
  };
  return earliestOfType("Trailer", true) ?? earliestOfType("Teaser", true)
    ?? earliestOfType("Trailer", false) ?? earliestOfType("Teaser", false);
}

// Full resolve for one show. Returns the ~11-char YouTube key, or null (miss).
export async function resolveTrailerKey(
  tvmazeId: number | string | null | undefined,
): Promise<string | null> {
  const headers = tmdbHeaders();
  if (!headers || tvmazeId == null || tvmazeId === "") return null;
  try {
    const tmdbId = await resolveTmdbTvId(tvmazeId, headers);
    if (tmdbId == null) return null;
    const res = await fetch(`${TMDB_BASE}/tv/${tmdbId}/videos`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return pickTrailerKey(data?.results);
  } catch {
    return null;
  }
}

// ── The landscape art (his notes after the landing-rule arc, 2026-11-02) ────
// The show's TMDB backdrop for the phone room's banner, through the same
// bridge: a TEXTLESS backdrop first (TMDB files one with no title text under
// no language), then one with English text, then the show's primary. The
// nightly refresh-shows run stores the same pick in shows.backdrop_url; this
// is for the room until that night (and for a show the run has missed).
function pickBackdropPath(backdrops: any[]): string | null {
  const by = (lang: string | null) => (backdrops ?? [])
    .filter((b) => (b?.iso_639_1 ?? null) === lang && typeof b?.file_path === "string")
    .sort((a, b) => (b?.vote_count ?? 0) - (a?.vote_count ?? 0));
  const pick = by(null)[0] ?? by("en")[0];
  return pick ? (pick.file_path as string) : null;
}
export async function resolveBackdropUrl(tvmazeId: number | string | null | undefined): Promise<string | null> {
  const headers = tmdbHeaders();
  if (!headers || tvmazeId == null || tvmazeId === "") return null;
  try {
    const tmdbId = await resolveTmdbTvId(tvmazeId, headers);
    if (tmdbId == null) return null;
    const res = await fetch(`${TMDB_BASE}/tv/${tmdbId}/images?include_image_language=null,en`, { headers });
    let path: string | null = null;
    if (res.ok) path = pickBackdropPath((await res.json())?.backdrops);
    if (!path) {
      const tv = await fetch(`${TMDB_BASE}/tv/${tmdbId}`, { headers });
      if (tv.ok) { const p = (await tv.json())?.backdrop_path; if (typeof p === "string" && p) path = p; }
    }
    return path ? `https://image.tmdb.org/t/p/w1280${path}` : null;
  } catch {
    return null;
  }
}
const _backdropCache = new Map<string, Promise<string | null>>();
export function getBackdropCached(showId: string, tvmazeId: number | string | null | undefined): Promise<string | null> {
  let p = _backdropCache.get(showId);
  if (!p) { p = resolveBackdropUrl(tvmazeId); _backdropCache.set(showId, p); }
  return p;
}

// ── In-memory cache (hits AND misses) ──────────────────────────────────────
// Keyed per showId, NOT stashed on Show objects: the shared catalog cache
// replaces whole Show objects on refresh and would clobber it. Three states:
//   • absent      → never attempted
//   • null        → attempted, MISS (don't re-run the failing bridge)
//   • string      → HIT
// Module lifetime; a page reload re-resolves on next demand (all third-party,
// zero Supabase egress).
const _cache = new Map<string, string | null>();
const _inflight = new Map<string, Promise<string | null>>();

export async function getTrailerKeyCached(
  showId: string,
  tvmazeId: number | string | null | undefined,
): Promise<string | null> {
  if (_cache.has(showId)) return _cache.get(showId) as string | null;
  const pending = _inflight.get(showId);
  if (pending) return pending;
  const p = (async () => {
    let key: string | null = null;
    try {
      key = await resolveTrailerKey(tvmazeId);
    } catch {
      key = null;
    }
    _cache.set(showId, key);
    _inflight.delete(showId);
    return key;
  })();
  _inflight.set(showId, p);
  return p;
}

// Fire-and-forget background warm-up: resolve trailers for a set of shows so
// the result is already cached before the viewer opens their opt-in modal —
// the click then has zero resolution latency. Bounded concurrency so it can't
// flood the browser's connection pool. Returns immediately (does NOT block the
// caller); already-cached / in-flight shows are skipped (getTrailerKeyCached
// dedupes). Callers should additionally defer the call (idle/timeout) so it
// never competes with the page's own initial load.
export function prefetchTrailers(
  shows: Array<{ id: string; tvmazeId: number | string | null | undefined }>,
): void {
  const queue = shows.filter(
    (s) => s.id && !_cache.has(s.id) && !_inflight.has(s.id),
  );
  if (!queue.length) return;
  const CONCURRENCY = 3;
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const s = queue[next++];
      try {
        await getTrailerKeyCached(s.id, s.tvmazeId);
      } catch {
        /* best-effort; misses are cached by getTrailerKeyCached */
      }
    }
  };
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) void worker();
}
