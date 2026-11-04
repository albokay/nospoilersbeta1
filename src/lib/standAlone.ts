/**
 * Stand alone mode (2026-11-04, his design on canvas Y3k7yZ5gvQqW5qC6fTeGdX).
 *
 * Some shows only need spoiler-gating per season: reality TV, game shows,
 * talk shows. In stand alone mode a person holds a PLACE PER SEASON on the
 * show instead of one position on the whole of it; the picker works as
 * today inside a season, and the season menu switches which season's place
 * you're setting (restoring where you were in it, or starting it at 0).
 *
 * This file is the mode's one source of truth on the client: which shows
 * are in it by default (TVMaze's type), the switch's state, and the words
 * of the "?" explainer. Nothing here changes how anything is sealed — the
 * rule (`canView`) stays the one position until CP2, and every path that
 * differs runs only when `showStandAlone(show)` is true.
 */
import { useEffect, useState } from "react";

/** TVMaze types that stand alone by default (his list, 11-04; sitcoms are NOT
 *  approximated from Scripted + Comedy — rejected). Compared lower-case. */
export const STAND_ALONE_TYPES = ["reality", "talk show", "documentary", "game show", "news", "sports", "variety", "award show", "panel show"];

export type StandAloneShow = { id?: string; tvmazeType?: string; standAlone?: boolean | null };

/** The default the type gives, before anyone flips the switch. */
export function standAloneDefault(show: StandAloneShow | null | undefined): boolean {
  const t = (show?.tvmazeType ?? "").trim().toLowerCase();
  return !!t && STAND_ALONE_TYPES.includes(t);
}

// ── The catalog, by id ─────────────────────────────────────────────────────
// Every show row that reaches the client passes db's _rowToShow, which notes
// it here, so the sealing rule (lib/utils canView) can ask about a show by
// the id a progress entry carries without holding the catalog itself.
const catalog = new Map<string, StandAloneShow>();

export function noteShowCatalog(show: StandAloneShow & { id: string }) {
  catalog.set(show.id, show);
}

// ── The switch's live state ────────────────────────────────────────────────
// A flip lands in the shows catalog (set_show_stand_alone) and the catalog
// cache is patched, but hosts hold their own snapshot of the show; this
// override map lets every picker on the page see the flip at once.
const overrides = new Map<string, boolean>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function noteStandAloneOverride(showId: string, on: boolean) {
  overrides.set(showId, on);
  notify();
}

/** Is this show in stand alone mode right now? The flip wins over the
 *  catalog's flag, which wins over the type's default. */
export function showStandAlone(show: StandAloneShow | null | undefined): boolean {
  if (!show) return false;
  if (show.id && overrides.has(show.id)) return overrides.get(show.id)!;
  if (typeof show.standAlone === "boolean") return show.standAlone;
  return standAloneDefault(show);
}

/** The same, by id (the flip wins, then the catalog's flag, then the
 *  type's default; a show the client hasn't seen is not in the mode). */
export function showStandAloneById(showId: string): boolean {
  return showStandAlone(catalog.get(showId) ?? { id: showId });
}

/** The switch shows on a show the type puts in the mode, and on any show
 *  someone switched on (so it can be switched off again). A show outside
 *  the list that nobody flipped keeps a bare picker (the gear-button way in
 *  is pinned for later). */
export function standAloneSwitchVisible(show: StandAloneShow | null | undefined): boolean {
  if (!show) return false;
  return standAloneDefault(show) || showStandAlone(show);
}

/** Re-renders when any switch flips. */
export function useStandAlone(show: StandAloneShow | null | undefined): boolean {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return showStandAlone(show);
}

// ── Per-season places ──────────────────────────────────────────────────────
// The viewer's own places, one map per show, kept here so a picker can
// restore a season's place the moment its menu changes and every write
// (db.ts) refreshes it without a refetch.
const places = new Map<string, Map<number, number>>();

export function getSeasonPlaces(showId: string): Map<number, number> | undefined {
  return places.get(showId);
}
export function setSeasonPlaces(showId: string, m: Map<number, number>) {
  places.set(showId, m);
  notify();
}
export function noteSeasonPlace(showId: string, season: number, episode: number) {
  const m = places.get(showId) ?? new Map<number, number>();
  m.set(season, episode);
  places.set(showId, m);
  notify();
}

const NO_PLACES: ReadonlyMap<number, number> = new Map<number, number>();

/** CP2 (2026-11-04): the places the sealing rule reads for a progress
 *  entry — a map when the entry's show is in stand alone mode (empty until
 *  loaded; the entry's own position still counts for its season), null
 *  when the show isn't, so the regular rule runs untouched. */
export function placesForEntry(p: { showId?: string } | null | undefined): ReadonlyMap<number, number> | null {
  if (!p?.showId || !showStandAloneById(p.showId)) return null;
  return places.get(p.showId) ?? NO_PLACES;
}

/** The viewer's place in each season of a show (empty until loaded). */
export function useSeasonPlaces(showId: string | undefined): Map<number, number> {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return (showId && places.get(showId)) || new Map<number, number>();
}

/** The "?"'s words (his copy, 11-04). */
export const STAND_ALONE_HELP = "Some shows only need spoiler-gating per season — reality TV for example. These are in “stand alone” mode by default. Pick the season you want to watch and writing on previous seasons stays sealed in case you want to watch the back catalogue later.";
