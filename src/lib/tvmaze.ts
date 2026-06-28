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
