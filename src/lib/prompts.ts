import type { Show } from "./db";
import type { PromptEntry } from "./promptData";

/**
 * Derive applicable progress tags from the user's current watch position and show metadata.
 * Tags are inclusive — a position can match multiple tags, and prompts filtered by any of them
 * are considered eligible.
 */
export function getProgressTags(
  progress: { s: number; e: number },
  show: Show
): string[] {
  const { s, e } = progress;
  const totalSeasons = show.seasons.length;
  const isFinalSeason = s === totalSeasons;
  const isRunning = show.status === "Running";
  const tags: string[] = ["any-progress"];

  if (s === 1 && e === 1) {
    // Very first episode
    tags.push("first-episode", "early");
  } else if (s === 1) {
    // Still in season 1 but past ep 1
    tags.push("early");
  } else if (isFinalSeason && isRunning) {
    // In the final season of a still-running show — heading toward the finale
    tags.push("pre-finale", "season-ending", "comparing-seasons");
    if (totalSeasons >= 3) tags.push("mid-series");
  } else if (isFinalSeason && !isRunning) {
    // In or past the final season of an ended show
    tags.push("season-ending", "post-show", "comparing-seasons");
    if (totalSeasons >= 3) tags.push("mid-series");
  } else {
    // s > 1 and not the final season
    if (e === 1) {
      // First episode of a new (non-final) season
      tags.push("new-season", "mid-season");
    } else {
      tags.push("mid-season");
    }
    if (totalSeasons >= 3) tags.push("mid-series");
    tags.push("comparing-seasons");
  }

  return tags;
}

/**
 * Returns true if a prompt entry is compatible with the given show's type and genres.
 * Both type AND genre must match. "all" / "all-genre" are wildcards.
 */
function matchesShow(p: PromptEntry, show: Show): boolean {
  // Type check
  if (!p.tvmazeTypes.includes("all")) {
    if (!show.tvmazeType) {
      // No tvmazeType on show — only match if prompt accepts all types
      return false;
    }
    if (!p.tvmazeTypes.includes(show.tvmazeType)) return false;
  }

  // Genre check
  if (!p.genres.includes("all-genre")) {
    if (!show.genres || show.genres.length === 0) {
      // No genres on show — only match if prompt accepts all genres
      return false;
    }
    const hasOverlap = show.genres.some((g) => p.genres.includes(g));
    if (!hasOverlap) return false;
  }

  return true;
}

/**
 * Returns true if any of the prompt's progress tags match the viewer's current progress tags.
 */
function matchesProgress(p: PromptEntry, progressTags: string[]): boolean {
  return p.progressTags.some((tag) => progressTags.includes(tag));
}

/**
 * Returns true if the prompt has a specific (non-any-progress) tag that matches the viewer's tags.
 * Used to prefer specifically-tagged prompts before falling back to any-progress.
 */
function matchesProgressSpecific(p: PromptEntry, progressTags: string[]): boolean {
  const specificViewerTags = progressTags.filter((t) => t !== "any-progress");
  if (!specificViewerTags.length) return false;
  return p.progressTags.some((tag) => tag !== "any-progress" && specificViewerTags.includes(tag));
}

/**
 * Pick a random fragment to use as the textarea placeholder.
 * Fragments with displayType "fragment" or "lighthearted-fragment" are considered.
 * If the show has no tvmazeType, only generic fragments (tvmazeTypes=["all"]) are used.
 */
export function getFragment(show: Show, prompts: PromptEntry[]): string {
  const fragmentPool = prompts.filter(
    (p) =>
      p.displayType === "fragment" || p.displayType === "lighthearted-fragment"
  );

  if (!fragmentPool.length) {
    return "What stayed with you from that episode?";
  }

  // If show has type/genre info, filter by show match; otherwise fall back to all-genre fragments
  let eligible: PromptEntry[];
  if (show.tvmazeType) {
    eligible = fragmentPool.filter((p) => matchesShow(p, show));
    if (!eligible.length) {
      eligible = fragmentPool.filter(
        (p) => p.tvmazeTypes.includes("all") && p.genres.includes("all-genre")
      );
    }
  } else {
    // No tvmazeType — only use fully generic fragments
    eligible = fragmentPool.filter(
      (p) => p.tvmazeTypes.includes("all") && p.genres.includes("all-genre")
    );
  }

  if (!eligible.length) eligible = fragmentPool;

  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  return pick.text;
}

/**
 * Get a random full prompt suggestion (displayType="prompt"), excluding already-shown ones.
 * Falls back to all-genre + any-progress pool if no match after filtering.
 */
export function getPromptSuggestion(
  show: Show,
  progress: { s: number; e: number },
  excludeIds: number[],
  prompts: PromptEntry[]
): PromptEntry | null {
  const progressTags = getProgressTags(progress, show);

  const fullPrompts = prompts.filter((p) => p.displayType === "prompt");

  if (!fullPrompts.length) return null;

  const excludeSet = new Set(excludeIds);

  // Tier A: show match + specific progress tag (not any-progress)
  let eligible = fullPrompts.filter(
    (p) =>
      !excludeSet.has(p.id) &&
      matchesShow(p, show) &&
      matchesProgressSpecific(p, progressTags)
  );

  // Tier B: generic (all/all-genre) + specific progress tag
  if (!eligible.length) {
    eligible = fullPrompts.filter(
      (p) =>
        !excludeSet.has(p.id) &&
        p.tvmazeTypes.includes("all") &&
        p.genres.includes("all-genre") &&
        matchesProgressSpecific(p, progressTags)
    );
  }

  // Tier C: show match + any-progress
  if (!eligible.length) {
    eligible = fullPrompts.filter(
      (p) =>
        !excludeSet.has(p.id) &&
        matchesShow(p, show) &&
        p.progressTags.includes("any-progress")
    );
  }

  // Tier D: fully generic + any-progress, not yet shown
  if (!eligible.length) {
    eligible = fullPrompts.filter(
      (p) =>
        !excludeSet.has(p.id) &&
        p.tvmazeTypes.includes("all") &&
        p.genres.includes("all-genre") &&
        p.progressTags.includes("any-progress")
    );
  }

  // Tier E: fully generic any-progress, ignoring exclusions
  if (!eligible.length) {
    eligible = fullPrompts.filter(
      (p) =>
        p.tvmazeTypes.includes("all") &&
        p.genres.includes("all-genre") &&
        p.progressTags.includes("any-progress")
    );
  }

  if (!eligible.length) return null;

  return eligible[Math.floor(Math.random() * eligible.length)];
}
