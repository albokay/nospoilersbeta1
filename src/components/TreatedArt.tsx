import React, { useState } from "react";

/**
 * TreatedArt — decorative cutout-plus-tint image anchored at the
 * bottom of a V2/V3 page. Source images are pre-generated and live in
 * the Supabase Storage public bucket "treated-art" at the key
 * `${showId}-${color}.png` (see scripts/generate-treated-art.ts).
 *
 * Per-mount semantics:
 *   - Color and side (left vs right) are rolled once when the
 *     component mounts and stay stable for the life of that instance.
 *   - To get a fresh roll on a page-internal change (e.g. switching
 *     journal tabs), the PARENT keys the element on the trigger:
 *     `<TreatedArt key={activeShowId} showId={activeShowId} … />`.
 *     React unmounts + remounts on key change → useState re-rolls.
 *   - On page revisit / fresh page mount, the component naturally
 *     re-rolls along with the rest of the tree.
 *
 * Loading + fade-in:
 *   - The <img> uses loading="lazy" and never blocks first paint.
 *   - Opacity starts at 0; on <img> onLoad it transitions to 1 over
 *     ~400ms, so the late arrival doesn't pop.
 *   - On 404 (cache miss for this (showId, color) combo — i.e. the
 *     pre-warm script hasn't generated this yet) the image stays
 *     invisible. No error UI; treated art is purely atmospheric.
 *
 * Layout:
 *   - `anchor="fixed"` → position: fixed; viewport-anchored.
 *   - `anchor="scroll"` → position: absolute; anchored to the nearest
 *     positioned ancestor. The page that wires this must wrap its
 *     content in a position:relative container tall enough to contain
 *     the scrolling content — see Phase 3 wiring.
 *   - z-index: 0 + pointer-events: none → never receives input, never
 *     occludes interactive content. The site's own elements default
 *     to z-index: auto which stacks above 0.
 *
 * Sizing + tilt:
 *   - width: min(640px, 60vw) — about 175% of the original first-pass
 *     size, scaled up after visual QA showed the art felt undersized
 *     at the originally proposed dimensions.
 *   - opacity target: 0.85 — softens the cutout against the page bg
 *     so it reads as atmospheric rather than dominant.
 *   - rotation: 15° leaning the art into the page from whichever
 *     corner it sits in. Left-anchored art rotates clockwise (top
 *     tilts toward center); right-anchored art rotates counter-
 *     clockwise (same effect, mirrored).
 */

// Canon palette for treated art. Red was dropped after visual QA —
// the warm red read too harsh against page backgrounds. Keep the list
// in sync with scripts/generate-treated-art.ts so the worker doesn't
// generate colors the client never asks for.
const CANON_TREATED_COLORS = [
  "yellow",
  "green",
  "dark-blue",
  "light-blue",
  "cream",
] as const;
type TreatedColor = (typeof CANON_TREATED_COLORS)[number];

type Side = "left" | "right";

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildUrl(showId: string, color: TreatedColor): string {
  // VITE_SUPABASE_URL is the same env var the rest of the app reads.
  // If it's missing (local dev with a stub .env.local), the URL will
  // be malformed and the <img> will silently fail to load — which is
  // the correct degrade behavior for atmospheric art.
  const base = (import.meta.env.VITE_SUPABASE_URL as string) || "";
  return `${base}/storage/v1/object/public/treated-art/${showId}-${color}.png`;
}

// 2026-05-24: temporarily disabled while investigating Supabase egress
// overage. Per-mount random-color roll + key-driven remount on 3 of 4
// mount sites was pulling 400KB-2.5MB PNGs on every tab/show switch.
// Flip back to `false` to restore. See HANDOFF "Treated-art follow-ups."
const DISABLED = true;

export default function TreatedArt({
  showId,
  anchor,
}: {
  showId: string | null | undefined;
  anchor: "fixed" | "scroll";
}) {
  if (DISABLED) return null;
  const [color] = useState<TreatedColor>(() => pickRandom(CANON_TREATED_COLORS));
  const [side] = useState<Side>(() => (Math.random() < 0.5 ? "left" : "right"));
  const [loaded, setLoaded] = useState(false);

  // No showId → nothing to anchor to. Render nothing (don't fire a
  // doomed image request to a malformed URL).
  if (!showId) return null;

  const url = buildUrl(showId, color);

  // Tilt + bleed.
  //
  // Rotation: left tilts CW (positive deg), right tilts CCW (negative
  // deg). Both pull the top edge toward the page's vertical centerline
  // so the art leans "into" the page from whichever corner.
  //
  // Translation pushes the art past the viewport edges so a portion
  // bleeds off-screen rather than sitting fully inside the layout:
  //   - translateY(40%): 40% of the image extends below the viewport
  //     (or below the scroll container, for anchor="scroll").
  //   - translateX(±20%): 20% extends past the anchor side.
  // Order matters — translate is applied first (right-to-left in CSS),
  // so the rotation happens after the bleed and the visible portion
  // tilts cleanly without compounding off-axis drift.
  const rotateDeg = side === "left" ? 15 : -15;
  const translateXPct = side === "left" ? -20 : 20;
  const translateYPct = 40;
  const transform = `translate(${translateXPct}%, ${translateYPct}%) rotate(${rotateDeg}deg)`;

  const style: React.CSSProperties = {
    position: anchor === "fixed" ? "fixed" : "absolute",
    bottom: 0,
    width: "min(448px, 42vw)",
    height: "auto",
    opacity: loaded ? 0.75 : 0,
    transform,
    transformOrigin: "center center",
    transition: "opacity 400ms ease-out",
    pointerEvents: "none",
    zIndex: 0,
    userSelect: "none",
    ...(side === "left" ? { left: 0 } : { right: 0 }),
  };

  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      draggable={false}
      style={style}
      onLoad={() => setLoaded(true)}
      // 404s for un-pre-warmed (showId, color) combos are expected;
      // leave the image invisible and move on. No console noise.
      onError={() => {}}
    />
  );
}
