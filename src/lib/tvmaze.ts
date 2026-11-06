// Shared TVMaze helpers. Extracted verbatim from SearchShows.tsx (2026-06-08,
// onboarding arc) so the new first-login OnboardingModal and the existing
// SearchShows flow share one source of truth instead of duplicating the
// (battle-tested) episode/airstamp logic. Behavior is unchanged from the
// pre-extraction SearchShows implementation.

export type TVmazeShow = {
  id: number;
  name: string;
  network?: { name: string } | null;
  webChannel?: { name: string } | null;
  premiered?: string | null;
  status?: string;
};

export async function tvmazeSearch(q: string): Promise<TVmazeShow[]> {
  const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data ?? []).map((r: any) => r.show).filter(Boolean);
}

export async function tvmazeEpisodes(tvmazeId: number): Promise<number[]> {
  const res = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/episodes`);
  // Network / fetch failure — fall back to a single placeholder season so the
  // picker has something to render. A genuinely unreleased show is handled
  // separately below by returning an empty array.
  if (!res.ok) return [1];
  const episodes: any[] = await res.json();
  const nowIso = new Date().toISOString();
  const bySeason: Record<number, number> = {};
  for (const ep of episodes) {
    const isRegular = ep.type === "regular" || !ep.type;
    // airstamp is an ISO 8601 timestamp with timezone; simple lexicographic
    // compare against now-ISO correctly handles timezone. airdate alone is
    // date-only and would give same-day-premiere users a one-day UX hole.
    const hasAired = typeof ep.airstamp === "string" && ep.airstamp <= nowIso;
    if (isRegular && hasAired) {
      bySeason[ep.season] = (bySeason[ep.season] ?? 0) + 1;
    }
  }
  const seasonKeys = Object.keys(bySeason).map(Number);
  if (!seasonKeys.length) return [];  // no aired episodes — picker should offer only "haven't started"
  const maxSeason = Math.max(...seasonKeys);
  const seasons: number[] = [];
  for (let i = 1; i <= maxSeason; i++) {
    seasons.push(bySeason[i] ?? 0);
  }
  return seasons;
}

// External IDs for a show (imdb / thetvdb / tvrage). Used by the trailers
// bridge (src/lib/trailers.ts) to cross TVMaze → TMDB without a name search.
// `externals` is NOT stored on our `shows` row, so we fetch the full show
// record on demand. Tolerant: any failure → null (caller treats as a miss).
export type TvmazeExternals = { imdb?: string | null; thetvdb?: number | null; tvrage?: number | null };

// Show art — module-cached per show (misses too): the MEDIUM poster (210 ×
// 295; the rows, the desktop poster — resolved per show at render since
// 2026-09-05) and the ORIGINAL (the phone room's banner, 2026-11-02: the
// medium goes soft stretched across a phone). One fetch serves both.
export type TvmazeArt = { medium: string | null; original: string | null };
const _artCache = new Map<string, Promise<TvmazeArt>>();
export function fetchTvmazeArt(tvmazeId: number | string): Promise<TvmazeArt> {
  const key = String(tvmazeId);
  let p = _artCache.get(key);
  if (!p) {
    p = (async (): Promise<TvmazeArt> => {
      try {
        const res = await fetch(`https://api.tvmaze.com/shows/${key}`);
        if (res.ok) { const img = (await res.json())?.image; return { medium: img?.medium ?? null, original: img?.original ?? null }; }
      } catch { /* miss */ }
      return { medium: null, original: null };
    })();
    _artCache.set(key, p);
  }
  return p;
}
export async function fetchTvmazePoster(tvmazeId: number | string): Promise<string | null> {
  return (await fetchTvmazeArt(tvmazeId)).medium;
}

export async function fetchTvmazeExternals(tvmazeId: number | string): Promise<TvmazeExternals | null> {
  try {
    const res = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.externals as TvmazeExternals) ?? null;
  } catch {
    return null;
  }
}

export function networkLabel(s: TVmazeShow): string {
  const net = s.network?.name || s.webChannel?.name || "";
  const year = s.premiered ? s.premiered.slice(0, 4) : "";
  return [net, year].filter(Boolean).join(", ");
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32) || `show${Date.now()}`;
}

// The season count for the "do you want to watch?" screens (his note,
// 11-06): seasons that have premiered, from TVMaze's seasons list (lighter
// than the episodes). Module-cached per show, misses too; null on failure.
const _seasonCountCache = new Map<string, Promise<number | null>>();
export function fetchSeasonCount(tvmazeId: number | string): Promise<number | null> {
  const key = String(tvmazeId);
  let p = _seasonCountCache.get(key);
  if (!p) {
    p = (async (): Promise<number | null> => {
      try {
        const res = await fetch(`https://api.tvmaze.com/shows/${key}/seasons`);
        if (!res.ok) return null;
        const list: any[] = await res.json();
        const today = new Date().toISOString().slice(0, 10);
        return list.filter((s) => Number(s?.number) > 0 && typeof s?.premiereDate === "string" && s.premiereDate <= today).length;
      } catch { return null; }
    })();
    _seasonCountCache.set(key, p);
  }
  return p;
}
