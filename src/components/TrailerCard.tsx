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
import { useEditorial } from "../lib/skin";
import { E } from "../styles/editorial";

// Canon palette (see memory canon_palette) — routed to src/styles/canon.ts.
const YELLOW = CANON.accent;
const CREAM = CANON.cream;

export default function TrailerCard({
  showId,
  tvmazeId,
  bleed = 0,
}: {
  showId: string;
  tvmazeId: number | string | null | undefined;
  /** The editorial skin (round 3): the host's side inset the band bleeds past, so it runs edge to edge. */
  bleed?: number;
}) {
  // undefined = resolving, null = miss, string = hit. Render only on a hit.
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const editorial = useEditorial();

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

  // The editorial band (Alborz's notes, round 3; the invitee board): an
  // edge-to-edge accent band, "Watch the trailer" in mono ink, the player in
  // a square frame with a cream "▶ Trailer" mark over the facade, the TMDB
  // line in small mono. Same facade, same player.
  if (editorial) {
    return (
      <div style={{ background: CANON.accent, color: E.color.ink, padding: `18px ${bleed || 20}px 14px`, boxSizing: "border-box", width: `calc(100% + ${bleed * 2}px)`, marginLeft: -bleed, marginRight: -bleed, textAlign: "left" }}>
        <div style={{ ...E.type.label11, color: E.color.ink, marginBottom: 12 }}>Watch the trailer</div>
        <div style={{ ...frame, borderRadius: 0, background: E.color.draft }}>
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
              <img src={`https://i.ytimg.com/vi/${key}/hqdefault.jpg`} loading="lazy" alt="" style={{ ...fill, objectFit: "cover" }} />
              <span aria-hidden style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", height: 40, padding: "0 16px", background: E.color.cream, color: E.color.ink, ...E.type.label11, display: "inline-flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 10 }}>▶</span> Trailer
              </span>
            </button>
          )}
        </div>
        <div style={{ ...E.type.label9, textTransform: "none", letterSpacing: "0.04em", lineHeight: 1.4, color: "rgba(26,58,74,0.75)", marginTop: 10 }}>
          Trailer data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={header}>Watch the trailer</div>
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
        Trailer data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
      </div>
    </div>
  );
}

// Fixed to the modal's width in BOTH contexts (spec §4); radius/padding
// share the show modal's card grammar (polish pass 2026-09-15) so the pair
// reads as one stack.
const card: React.CSSProperties = {
  background: YELLOW,
  borderRadius: 24,
  padding: "24px 32px 20px",
  width: "min(460px, 92vw)",
  boxSizing: "border-box",
  textAlign: "center",
};
// Header 2 = Inter bold 14, normal letter-spacing (canon_typography).
const header: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif',
  fontWeight: 700,
  fontSize: 14,
  color: CANON.cream,
  textAlign: "left",
  marginBottom: 12,
};
const frame: React.CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "16 / 9",
  borderRadius: 12,
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
// 11px cream at 0.85 (polish pass 2026-09-15; the 10px dark line was ≈2.6:1
// on yellow), and it says what the data is for.
const attribution: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif',
  fontWeight: 400,
  fontSize: 11,
  lineHeight: 1.4,
  color: CREAM,
  opacity: 0.85,
  textAlign: "left",
  marginTop: 10,
};
const playTriangle: React.CSSProperties = {
  width: 0,
  height: 0,
  marginLeft: 4,
  borderTop: "12px solid transparent",
  borderBottom: "12px solid transparent",
  borderLeft: `20px solid ${CREAM}`,
};
