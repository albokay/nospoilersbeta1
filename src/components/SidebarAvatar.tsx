import React from "react";
import { CANON } from "../styles/canon";
import Avatar from "boring-avatars";

/**
 * Sidebar's avatar primitive. Wraps boring-avatars with the canon palette
 * and the `beam` variant baked in. ALL surfaces use this wrapper — never
 * import boring-avatars directly. One file owns variant + palette + seed
 * strategy so swapping any of them is a single-file change.
 *
 * Seed: userId-first (first-name identity arc CP2, 2026-07-10) — the
 * public-rooms hedge: a future handle rename (claim-a-vanity-handle) must
 * not change anyone's avatar, and user_id never changes. Every LIVE
 * surface passes userId (reply bylines gained Reply.authorId for this).
 * The username fallback exists only for dormant/retired pages and
 * anonymized authors (author_id nulled on account deletion) — the
 * historical mixed-seed bug (same person, different avatars, because SOME
 * live surfaces seeded by name) can't recur as long as live callsites
 * keep passing userId. One-time consequence, accepted 2026-07-10: every
 * pre-existing account's avatar changed appearance once at this flip.
 *
 * Palette: Sidebar canon — yellow / green / dark-blue / light-blue / red.
 * Hexes mirrored from theme.ts:6-18 (the CSS-vars source of truth).
 * boring-avatars expects a runtime string[] for `colors`, so CSS-var
 * indirection isn't available here; if any of these hexes change in
 * theme.ts, update this array in the same commit.
 */
const CANON_PALETTE = [
  CANON.accent, // canon yellow  (theme.ts:74 — public-context --dos-bg)
  CANON.personal, // canon green   (theme.ts:8 — --green)
  CANON.identity, // canon dark blue (theme.ts:8 — --dos-user)
  CANON.friend, // canon light blue (theme.ts:18 — --blue-light)
  CANON.alert, // canon red     (theme.ts:8 — --danger)
];

type SidebarAvatarProps = {
  userId?: string | null;
  username?: string | null;
  size?: number;
};

export default function SidebarAvatar({ userId, username, size = 24 }: SidebarAvatarProps) {
  const seed = userId || username || "anon";
  return (
    <Avatar
      name={seed}
      variant="bauhaus"
      size={size}
      colors={CANON_PALETTE}
    />
  );
}
