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
// the earliest Teaser. Missing published_at sorts last (+Infinity).
function pickTrailerKey(results: any[]): string | null {
  const earliestOfType = (type: string): string | null => {
    const vids = (results ?? []).filter(
      (v) => v?.site === "YouTube" && v?.official === true && v?.type === type,
    );
    vids.sort((a, b) => {
      const ta = a?.published_at ? Date.parse(a.published_at) : NaN;
      const tb = b?.published_at ? Date.parse(b.published_at) : NaN;
      return (isNaN(ta) ? Infinity : ta) - (isNaN(tb) ? Infinity : tb);
    });
    const key = vids[0]?.key;
    return typeof key === "string" && key ? key : null;
  };
  return earliestOfType("Trailer") ?? earliestOfType("Teaser");
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
