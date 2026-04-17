import React from "react";
import { HatGlasses } from "lucide-react";
import Tooltip from "./Tooltip";

const CANON_RED = "#f45028";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Render an episode tag for a thread or reply.
// - Regular posts: `(S01 E04)` with optional separator glyph.
// - Rewatch posts: hat-glasses icon (canon-red) + `(S01E04 / S03E09)` where
//   the first number is the author's rewatch position at time of writing and
//   the second is their highest at time of writing (= the filter tag).
//   Tooltip on hover explains the two numbers.
export default function EpisodeTag({
  season,
  episode,
  isRewatch = false,
  rewatchS,
  rewatchE,
  parens = true,
  useSpacing = true,
}: {
  season: number;
  episode: number;
  isRewatch?: boolean;
  rewatchS?: number;
  rewatchE?: number;
  parens?: boolean;
  useSpacing?: boolean; // if true, "S01 E04"; if false, "S01E04"
}) {
  const sep = useSpacing ? " " : "";
  const mainLabel = `S${pad(season)}${sep}E${pad(episode)}`;
  const regular = parens ? `(${mainLabel})` : mainLabel;

  // Non-rewatch: just render the tag text.
  if (!isRewatch || rewatchS == null || rewatchE == null) {
    return <>{regular}</>;
  }

  // Rewatch: icon + (rewatch / highest) with smaller highest.
  const rewatchLabel = `S${pad(rewatchS)}${sep}E${pad(rewatchE)}`;
  const tooltipText =
    "A rewatch post. The lower number shows where they are on this rewatch. The higher number is how far they got the first time.";

  return (
    <Tooltip text={tooltipText} direction="above">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
        <HatGlasses size={13} color={CANON_RED} style={{ flexShrink: 0 }} />
        <span>
          {parens && "("}
          <span>{rewatchLabel}</span>
          <span style={{ opacity: 0.7, margin: "0 2px" }}>/</span>
          <span style={{ fontSize: "0.85em" }}>{mainLabel}</span>
          {parens && ")"}
        </span>
      </span>
    </Tooltip>
  );
}
