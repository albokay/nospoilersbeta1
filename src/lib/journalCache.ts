// Persistent first-paint cache for the journal page (and any other surface
// that needs progress + show-activity data on mount). Backed by localStorage
// so a returning user's tab list + spoiler context renders before any
// network round-trip.
//
// Pattern: caller hydrates from cache synchronously on mount, kicks off the
// real fetch in the background, and reconciles when the fetch resolves.
// Cache TTL is conservative (1 hour) — balances "stale data flash" risk
// against the perf benefit. Cache is per-user via the localStorage key
// shape so multiple accounts in one browser don't bleed.
//
// Risk model: stale data is shown briefly between hydrate and refresh.
// For progress, that means the spoiler filter may temporarily over-hide
// (cache shows lower watch position than DB) or under-hide (cache shows
// higher watch position) for ~hundreds of ms before the refresh corrects.
// Spoiler under-hiding is the only direction worth caring about, and
// requires (a) the user advanced their progress on a different device
// since their last visit AND (b) a friend posted at a level above the
// cached position AND (c) the user reads the post within the brief
// hydrate-to-refresh window. Acceptable trade for the perf gain.

import type { ProgressEntry } from "../types";

const PROGRESS_KEY_PREFIX = "ns_cache_progress_";
const ACTIVITY_KEY_PREFIX = "ns_cache_activity_";
// 1 hour. Old enough that "user comes back the next day" still reads fresh
// from network; new enough that within-session navigation reads from cache.
const CACHE_TTL_MS = 60 * 60 * 1000;

type CachedEnvelope<T> = { data: T; fetchedAt: number };

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: CachedEnvelope<T> = JSON.parse(raw);
    if (!parsed || typeof parsed.fetchedAt !== "number") return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    const env: CachedEnvelope<T> = { data, fetchedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(env));
  } catch {
    // localStorage full / disabled / privacy mode — best-effort, swallow.
  }
}

// ── Progress cache ────────────────────────────────────────────────────────
// Mirrors fetchProgress(userId)'s return shape: Record<showId, ProgressEntry>.

export function getCachedProgress(userId: string): Record<string, ProgressEntry> | null {
  if (!userId) return null;
  return readCache<Record<string, ProgressEntry>>(PROGRESS_KEY_PREFIX + userId);
}

export function setCachedProgress(userId: string, progress: Record<string, ProgressEntry>): void {
  if (!userId) return;
  writeCache(PROGRESS_KEY_PREFIX + userId, progress);
}

// ── Show-activity cache ───────────────────────────────────────────────────
// Mirrors fetchUserShowActivity(userId)'s return shape: array of
// { showId, latestAt } pairs that drive showTabOrder on the journal page.

export type ActivityRow = { showId: string; latestAt: number };

export function getCachedActivity(userId: string): ActivityRow[] | null {
  if (!userId) return null;
  return readCache<ActivityRow[]>(ACTIVITY_KEY_PREFIX + userId);
}

export function setCachedActivity(userId: string, activity: ActivityRow[]): void {
  if (!userId) return;
  writeCache(ACTIVITY_KEY_PREFIX + userId, activity);
}

// ── Invalidation ──────────────────────────────────────────────────────────
// Optional: callers can clear their cache after known-mutating actions
// (post submit, progress change, etc.) to force the next mount to re-fetch
// even within TTL. Default flow doesn't require it — the background
// refresh on every mount keeps things fresh on its own.

export function invalidateJournalCache(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(PROGRESS_KEY_PREFIX + userId);
    localStorage.removeItem(ACTIVITY_KEY_PREFIX + userId);
  } catch {
    // ignore
  }
}
