/**
 * ensureCatalogShow — make sure a browse-row poster's show exists in Sidebar's
 * shows catalog and return it (browse-rows arc, 2026-08-18; extracted from the
 * group rooms' pickBrowseShow so onboarding can share it).
 *
 * The rows are keyed by TVMaze id (most posters are shows nobody on Sidebar
 * has added yet). Adding to the catalog is the same side effect as picking a
 * TVMaze search result — a shared cache of TVMaze data, accepted by Alborz.
 * A same-titled show already owning slugify(name) (a remake) must NOT have its
 * seasons overwritten by createShow's conflict-UPDATE fallback — the id gets
 * a tvmaze suffix instead.
 */
import { createShow, type Show, type BrowseShow } from "./db";
import { tvmazeEpisodes, slugify } from "./tvmaze";

export async function ensureCatalogShow(shows: Show[], b: Pick<BrowseShow, "tvmazeId" | "name">): Promise<Show> {
  const tvId = String(b.tvmazeId);
  const existing = shows.find((s) => s.tvmazeId === tvId);
  if (existing) return existing;
  const [seasons, rec] = await Promise.all([
    tvmazeEpisodes(b.tvmazeId),
    fetch(`https://api.tvmaze.com/shows/${b.tvmazeId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  let id = slugify(b.name);
  const clash = shows.find((s) => s.id === id && s.tvmazeId && s.tvmazeId !== tvId);
  if (clash) id = `${id}-${tvId}`;
  return createShow({ id, name: rec?.name ?? b.name, seasons, tvmazeId: tvId, status: rec?.status });
}
