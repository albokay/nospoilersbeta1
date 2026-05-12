// Prompt library for "Thoughts on..." pieces on the V2 profile.
//
// Each entry is a phrase that completes the locked opener "Thoughts on " —
// i.e. the user-facing title displayed in the compose modal becomes
// "Thoughts on [prompt]." when a prompt is auto-suggested.
//
// Curated by hand for now; iterate on this file directly. If the library
// ever grows enough to need an admin editor, migrate to a `profile_thought_prompts`
// table (parallels the existing `prompts` pattern for show-entry prompts).
// Until then, the file is the source of truth.

export const PROFILE_THOUGHT_PROMPTS: string[] = [
  "a show you think about more than you should",
  "a show you defend to people who don't like it",
  "a show you watched at the wrong time in your life",
  "a show that ruined other shows for you",
  "a show you wish you could watch for the first time again",
  "a show you and one specific person bonded over",
  "a show you watched alone that you wish you'd watched with someone",
  "a show that made you think differently about your family",
  "what you watch when you're sick at home",
  "watching alone vs. with others",
  "a show you started and never finished for a good reason",
  "a show that's a comfort rewatch",
];

/**
 * Pick a fresh prompt that isn't the given current one. Used by both the
 * compose modal's title cycling affordance and the profile empty-state
 * cycling prompt. If `current` matches every prompt (impossible) or the
 * library is empty (also impossible), falls back to the first entry.
 */
export function pickProfileThoughtPrompt(current: string | null): string {
  const pool = current
    ? PROFILE_THOUGHT_PROMPTS.filter((p) => p !== current)
    : PROFILE_THOUGHT_PROMPTS;
  if (!pool.length) return PROFILE_THOUGHT_PROMPTS[0] ?? "";
  return pool[Math.floor(Math.random() * pool.length)];
}
