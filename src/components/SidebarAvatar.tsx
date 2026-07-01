import React from "react";
import { CANON } from "../styles/canon";
import Avatar from "boring-avatars";

/**
 * Sidebar's avatar primitive. Wraps boring-avatars with the canon palette
 * and the `beam` variant baked in. ALL surfaces use this wrapper — never
 * import boring-avatars directly. One file owns variant + palette + seed
 * strategy so swapping any of them is a single-file change.
 *
 * Seed: username, every time. Originally userId-first with username
 * fallback, but most byline surfaces only carry the username string —
 * the mixed-seed model made the same user render as different avatars
 * across the site (e.g. byline used "libdenk" while NudgePopover used
 * the UUID). Pinning to username gives one avatar per user everywhere.
 * Tradeoff: if username-change ever ships, a user's avatar would change
 * with their handle. Sidebar doesn't expose username editing today, so
 * the tradeoff is theoretical for now.
 *
 * Palette: Sidebar canon — yellow / green / dark-blue / light-blue / red.
 * Hexes mirrored from theme.ts:6-18 (the CSS-vars source of truth).
 * boring-avatars expects a runtime string[] for `colors`, so CSS-var
 * indirection isn't available here; if any of these hexes change in
 * theme.ts, update this array in the same commit.
 */
const CANON_PALETTE = [
  CANON.yellow, // canon yellow  (theme.ts:74 — public-context --dos-bg)
  CANON.green, // canon green   (theme.ts:8 — --green)
  CANON.blue, // canon dark blue (theme.ts:8 — --dos-user)
  CANON.sky, // canon light blue (theme.ts:18 — --blue-light)
  CANON.red, // canon red     (theme.ts:8 — --danger)
];

type SidebarAvatarProps = {
  userId?: string | null;
  username?: string | null;
  size?: number;
};

export default function SidebarAvatar({ userId, username, size = 24 }: SidebarAvatarProps) {
  const seed = username || userId || "anon";
  return (
    <Avatar
      name={seed}
      variant="bauhaus"
      size={size}
      colors={CANON_PALETTE}
    />
  );
}
