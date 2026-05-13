import React from "react";
import Avatar from "boring-avatars";

/**
 * Sidebar's avatar primitive. Wraps boring-avatars with the canon palette
 * and the `beam` variant baked in. ALL surfaces use this wrapper — never
 * import boring-avatars directly. One file owns variant + palette + seed
 * strategy so swapping any of them is a single-file change.
 *
 * Seed: prefer userId (stable across username changes); fall back to
 * username when an id isn't available at the call site. If username-change
 * ever ships, plumb authorId through the data layer so this fallback isn't
 * exercised on user-attributable surfaces.
 *
 * Palette: Sidebar canon — yellow / green / dark-blue / light-blue / red.
 * Hexes mirrored from theme.ts:6-18 (the CSS-vars source of truth).
 * boring-avatars expects a runtime string[] for `colors`, so CSS-var
 * indirection isn't available here; if any of these hexes change in
 * theme.ts, update this array in the same commit.
 */
const CANON_PALETTE = [
  "#dea838", // canon yellow  (theme.ts:74 — public-context --dos-bg)
  "#7abd8e", // canon green   (theme.ts:8 — --green)
  "#355eb8", // canon dark blue (theme.ts:8 — --dos-user)
  "#adc8d7", // canon light blue (theme.ts:18 — --blue-light)
  "#f45028", // canon red     (theme.ts:8 — --danger)
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
      variant="beam"
      size={size}
      colors={CANON_PALETTE}
    />
  );
}
