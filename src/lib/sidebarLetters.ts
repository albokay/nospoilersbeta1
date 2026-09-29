/**
 * Letters from Sidebar (Alborz 2026-09-28): the "what's next" and "returning
 * season" alerts are LETTERS planted in a show room by the digest run, so the
 * digest, the room's blue disc, the deep link and realtime all treat them
 * like any letter. The Sidebar identity is a profiles row (no sign-in
 * account — threads.author_id points at profiles); the feed recognises its
 * letters by the author handle. They're tagged S0 E0 so every member can
 * read them, pinned to the top of the feed, and wear the explainer's framed
 * stamp with the letter's own words. Which letter is which comes from the
 * room's sidebar_letters rows.
 */
export const SIDEBAR_USERNAME = "sidebar";
export const SIDEBAR_USER_ID = "00000000-0000-4000-8000-000000000001";
export const SIDEBAR_DISPLAY_NAME = "Sidebar";

export type SidebarLetterKind = "whats_next" | "returning";

export const isSidebarAuthor = (username: string | null | undefined): boolean => username === SIDEBAR_USERNAME;

/** The stamp's two stacked words. A letter whose row hasn't landed (or an
 *  unknown kind) wears the explainer's "Season / Episode". */
export const sidebarStampLabel = (kind?: SidebarLetterKind | null): string =>
  kind === "whats_next" ? "What\nnext?" : kind === "returning" ? "next\nseason" : "Season\nEpisode";

/** The byline tag on responses to the letter — the letter's label, in its
 *  case (his call: "What next?" / "next season"). */
export const sidebarTag = (kind?: SidebarLetterKind | null): string =>
  kind === "whats_next" ? "What next?" : kind === "returning" ? "next season" : "from Sidebar";

/** The explainer's stamp: framed with the inner box, no ornament, no mark. */
export const SIDEBAR_STAMP_SPEC = { family: 2, ornament: 5, cancel: 0, tilt: 3 } as const;
