import React from "react";
import { HatGlasses } from "lucide-react";
import Tooltip from "./Tooltip";

const CANON_RED = "#f45028";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Render an episode tag for a thread or reply.
// - Regular posts: `(S01 E04)` with optional separator glyph.
// - Rewatch posts: `(S01E04 [hat-glasses] S03E09)` — the hat-glasses icon
//   (canon-red) sits between the two episode tags in place of a separator
//   glyph. Both tags render at the same size/weight. First number = rewatch
//   position at time of writing; second = author's highest at time of
//   writing (the filter tag). Tooltip on hover explains the two numbers.
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

  // Rewatch: (rewatchEp [icon] highestEp). Icon replaces the "/" separator;
  // both labels render at the same size/weight.
  const rewatchLabel = `S${pad(rewatchS)}${sep}E${pad(rewatchE)}`;
  const tooltipText =
    "A rewatch post. The lower episode number is where they are on their rewatch. The higher episode number is how far they got the first time they watched the show.";

  return (
    <Tooltip
      text={tooltipText}
      direction="below"
      tooltipStyle={{ background: "#adc8d7", color: "#1a2c3a", boxShadow: "0 4px 20px rgba(0,0,0,0.18)" }}
      portal
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
        {parens && "("}
        <span>{rewatchLabel}</span>
        <HatGlasses size={16} color={CANON_RED} style={{ flexShrink: 0 }} />
        <span>{mainLabel}</span>
        {parens && ")"}
      </span>
    </Tooltip>
  );
}
