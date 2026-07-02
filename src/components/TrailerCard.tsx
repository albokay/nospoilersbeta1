// TrailerCard — the launch-trailer facade shown beneath a pre-watch opt-in
// modal. Self-resolves via getTrailerKeyCached; renders NOTHING until a hit
// (no skeleton, no space reservation — a one-time pop-in shift is accepted per
// spec §5/§7). Facade thumbnail on mount; the real youtube-nocookie iframe is
// created only after the user clicks play (no autoplay-on-mount).
//
// Spec: ~/Downloads/sidebar_trailers_spec.md.

import React, { useEffect, useState } from "react";
import { getTrailerKeyCached } from "../lib/trailers";
import { CANON } from "../styles/canon";

// Canon palette (see memory canon_palette) — routed to src/styles/canon.ts.
const YELLOW = CANON.accent;
const CREAM = CANON.cream;

export default function TrailerCard({
  showId,
  tvmazeId,
}: {
  showId: string;
  tvmazeId: number | string | null | undefined;
}) {
  // undefined = resolving, null = miss, string = hit. Render only on a hit.
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setKey(undefined);
    setPlaying(false);
    getTrailerKeyCached(showId, tvmazeId)
      .then((k) => { if (!cancelled) setKey(k); })
      .catch(() => { if (!cancelled) setKey(null); });
    return () => { cancelled = true; };
  }, [showId, tvmazeId]);

  // Resolving (undefined) or miss (null) → render nothing.
  if (!key) return null;

  return (
    <div style={card}>
      <div style={header}>Watch the trailer:</div>
      <div style={frame}>
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title="Trailer"
            style={fill}
          />
        ) : (
          <button style={facadeBtn} onClick={() => setPlaying(true)} aria-label="Play trailer">
            <img
              src={`https://i.ytimg.com/vi/${key}/hqdefault.jpg`}
              loading="lazy"
              alt=""
              style={{ ...fill, objectFit: "cover" }}
            />
            <span style={playOverlay} aria-hidden>
              <span style={playTriangle} />
            </span>
          </button>
        )}
      </div>
      {/* TMDB attribution — required by the (free, personal-use) TMDB API
          license. Trailer data is sourced from TMDB. */}
      <div style={attribution}>
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </div>
    </div>
  );
}

// Fixed to the wider modal's width in BOTH contexts (spec §4).
const card: React.CSSProperties = {
  background: YELLOW,
  borderRadius: 15,
  padding: "20px 24px",
  width: "min(460px, 92vw)",
  boxSizing: "border-box",
  textAlign: "center",
};
// Header 2 = Inter bold 14, normal letter-spacing (canon_typography).
const header: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif',
  fontWeight: 700,
  fontSize: 14,
  color: "#FEF8EA",
  textAlign: "left",
  marginBottom: 12,
};
const frame: React.CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "16 / 9",
  borderRadius: 10,
  overflow: "hidden",
  background: "rgba(26,58,74,0.25)",
};
const fill: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  border: "none",
  display: "block",
};
const facadeBtn: React.CSSProperties = {
  ...fill,
  padding: 0,
  cursor: "pointer",
  background: "transparent",
};
const playOverlay: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 64,
  height: 64,
  borderRadius: "50%",
  background: "rgba(26,58,74,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
// Info = Inter regular 10 (canon_typography), muted, left-aligned under the frame.
const attribution: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif',
  fontWeight: 400,
  fontSize: 10,
  lineHeight: 1.3,
  color: "rgba(26,58,74,0.7)",
  textAlign: "left",
  marginTop: 8,
};
const playTriangle: React.CSSProperties = {
  width: 0,
  height: 0,
  marginLeft: 4,
  borderTop: "12px solid transparent",
  borderBottom: "12px solid transparent",
  borderLeft: `20px solid ${CREAM}`,
};
