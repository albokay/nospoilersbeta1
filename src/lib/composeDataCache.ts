import {
  fetchShows,
  fetchProgress,
  fetchFriendGroupsForUser,
  fetchPrompts,
} from "./db";
import type { Show, PromptRow } from "./db";
import type { ProgressEntry, FriendGroup } from "../types";
import type { PromptEntry } from "./promptData";

// Pre-fetched bundle of everything V2ComposePage needs to render its
// initial state. Populated by prefetchComposeData (called from the
// V3JournalPage write-button hover); consumed by V2ComposePage on mount.
// The point: when the user hovers + then clicks write, the compose page
// has data already and renders without a network round-trip.
export type ComposeBootstrap = {
  show: Show;
  progress: ProgressEntry;
  groups: FriendGroup[];
  promptEntries: PromptEntry[];
  fetchedAt: number;
};

// Module-level cache. Single-tab scope; doesn't persist across reloads.
// Key shape: `${userId}:${showId}` so multiple users / shows can coexist
// (admin testing, share switches in dev, etc.).
const cache = new Map<string, ComposeBootstrap>();

function key(userId: string, showId: string): string {
  return `${userId}:${showId}`;
}

// Fire all four queries in parallel + store the processed bundle. Idempotent
// per (user, show) — repeated calls overwrite the prior cache, so a hover
// just before click always gets the freshest data.
//
// Errors are swallowed (logged + return) because this is a hint-only path:
// if prefetch fails, V2ComposePage's own bootstrap will try again on mount
// and surface any real error to the user.
export async function prefetchComposeData(userId: string, showId: string): Promise<void> {
  if (!userId || !showId) return;
  try {
    const [allShows, prog, gs, pr] = await Promise.all([
      fetchShows(),
      fetchProgress(userId),
      fetchFriendGroupsForUser(userId, showId),
      fetchPrompts().catch(() => [] as PromptRow[]),
    ]);
    const show = allShows.find((s) => s.id === showId);
    if (!show) return; // no point caching an invalid show; let the bootstrap report the error
    const progress = prog[showId];
    if (!progress) return; // same — bootstrap shows the "no journal tab" hint
    // Snake_case → camelCase mapper, mirrors V2ComposePage's inline shape.
    const promptEntries: PromptEntry[] = pr.map((r) => ({
      id: r.id,
      text: r.text,
      displayType: r.display_type,
      tvmazeTypes: r.tvmaze_types,
      genres: r.genres,
    }) as PromptEntry);
    cache.set(key(userId, showId), {
      show,
      progress,
      groups: gs,
      promptEntries,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    console.warn("prefetchComposeData failed (non-blocking):", err);
  }
}

// Returns the cached bundle if present, regardless of age. Caller decides
// whether the data is fresh enough; for v1, V2ComposePage just hydrates
// and trusts the cache for the user's current session — they hovered the
// button moments ago, so it's near-real-time. Cache is invalidated
// explicitly on successful submit (see clearComposeDataCache).
export function getCachedComposeData(userId: string, showId: string): ComposeBootstrap | null {
  if (!userId || !showId) return null;
  return cache.get(key(userId, showId)) ?? null;
}

// Drop the cache entry for a (user, show) pair. Called by V2ComposePage
// after a successful submit so the next compose visit re-fetches (the
// just-submitted post would otherwise be missing from the friend-room
// list / progress derivation if the user duplicates or composes again).
export function clearComposeDataCache(userId: string, showId: string): void {
  if (!userId || !showId) return;
  cache.delete(key(userId, showId));
}
