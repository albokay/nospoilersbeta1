// The spoiler-gated reference (CP0/CP1, 2026-09-05) — client side.
//
// One cached JSON index per show (built server-side by the
// build-show-reference edge function; see its header for the safety rules).
// The client loads the whole blob and gates every item against the viewer's
// own progress — safe per the M1 rationale: the only person this data could
// spoil is the viewer.

import { supabase } from "./supabaseClient";

export type RefEpisode = {
  s: number; e: number; title: string;
  airDate: string | null; summary: string | null;
  writers: string[]; directors: string[]; dp: string[];
};
export type RefPerson = {
  name: string; character: string | null;
  firstS: number; firstE: number;
  /** true = exact first episode known (guest credit) → "since S1 E4";
   *  false = season-level (series regular) → "since season 2". */
  exact: boolean;
  img: string | null;
};
export type RefSeason = { n: number; trailerKey: string | null; episodes: RefEpisode[] };
export type ShowReferenceData = {
  builtAt: string;
  showName: string;
  createdBy: string[];
  launchTrailerKey: string | null;
  seasons: RefSeason[];
  people: RefPerson[];
  /** enwiki article the episode summaries came from (attribution link);
   *  absent/null = no Wikipedia summaries in this blob. */
  wikipediaTitle?: string | null;
};

// Per-session module cache — a show's reference is fetched once per visit.
const _refCache = new Map<string, ShowReferenceData>();
const _refInflight = new Map<string, Promise<ShowReferenceData>>();

/** Load (building server-side on the first-ever open) a show's reference. */
export function ensureShowReference(showId: string): Promise<ShowReferenceData> {
  const hit = _refCache.get(showId);
  if (hit) return Promise.resolve(hit);
  const inflight = _refInflight.get(showId);
  if (inflight) return inflight;
  const p = (async () => {
    const { data, error } = await supabase.functions.invoke("build-show-reference", {
      body: { show_id: showId },
    });
    if (error) throw error;
    if (!data?.ok || !data?.data) throw new Error(data?.error || "reference unavailable");
    const ref = data.data as ShowReferenceData;
    _refCache.set(showId, ref);
    return ref;
  })().finally(() => { _refInflight.delete(showId); });
  _refInflight.set(showId, p);
  return p;
}

/** Stamp "you've looked this up" on the viewer's own progress row — feeds
 *  the dashboard band's cross-device recent-lookups row (capped at read
 *  time). Tolerant: pre-migration or rowless shows just don't stamp. */
export async function stampReferenceLookup(userId: string, showId: string): Promise<void> {
  try {
    await supabase
      .from("progress")
      .update({ last_looked_up_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("show_id", showId);
  } catch { /* tolerate */ }
}
