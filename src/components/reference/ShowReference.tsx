// ShowReference — the spoiler-gated reference tab's body (CP1, 2026-09-05).
// Shared by the desktop + mobile show pages (idiom prop sizes it). Renders a
// show's cached reference index gated to the VIEWER'S OWN progress: watched
// episodes in full, everything past the dial as folded shape-only cells (the
// season map's disclosure rule — shape visible, contents not). Copy locked
// by Alborz 2026-09-05. Never rendered below S1E1 (the tab is hidden until
// the dial reaches it — "no 0-state reference page").

import React, { useEffect, useMemo, useState } from "react";
import { CANON } from "../../styles/canon";
import LoadingDots from "../LoadingDots";
import { ensureShowReference, stampReferenceLookup, type ShowReferenceData } from "../../lib/reference";
import { useAuth } from "../../lib/auth";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const CREAM = CANON.cream;
const idx = (s: number, e: number) => s * 10000 + e;

export default function ShowReference({
  showId, viewerProgress, mobile = false,
}: {
  showId: string;
  /** The viewer's EFFECTIVE progress (rewatch-aware ceiling) — ≥ S1E1. */
  viewerProgress: { s: number; e: number };
  mobile?: boolean;
}) {
  const { user } = useAuth();
  const [ref, setRef] = useState<ShowReferenceData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRef(null);
    setFailed(false);
    ensureShowReference(showId)
      .then((r) => { if (!cancelled) setRef(r); })
      .catch(() => { if (!cancelled) setFailed(true); });
    // Feeds the dashboard band's "You've looked up:" row (cross-device).
    if (user) stampReferenceLookup(user.id, showId);
    return () => { cancelled = true; };
  }, [showId, user?.id]);

  const vIdx = idx(viewerProgress.s, viewerProgress.e);

  const visiblePeople = useMemo(
    () => (ref?.people ?? []).filter((p) => idx(p.firstS, p.firstE) <= vIdx),
    [ref, vIdx],
  );

  if (failed) {
    return (
      <div style={{ color: CREAM, fontSize: 14, lineHeight: 1.5, maxWidth: 460 }}>
        The reference couldn&rsquo;t load just now. Try again in a minute.
      </div>
    );
  }
  if (!ref) {
    return (
      <div style={{ color: CREAM }}>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14 }}>
          building this show&rsquo;s reference<LoadingDots />
        </span>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6, fontStyle: "italic" }}>
          (first visit only — takes a few seconds)
        </div>
      </div>
    );
  }

  const sectionH: React.CSSProperties = {
    fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 22 : 26, color: CREAM,
    margin: "36px 0 14px",
  };
  const small: React.CSSProperties = { fontSize: 12, color: CREAM, opacity: 0.85 };

  return (
    <div style={{ color: CREAM, fontFamily: '"Inter", sans-serif', paddingBottom: 80 }}>
      {ref.createdBy.length > 0 && (
        <div style={{ fontSize: 13, opacity: 0.9 }}>created by {ref.createdBy.join(" & ")}</div>
      )}
      {/* Attribution — on the page, per the idea doc (not a footer). */}
      <div style={{ ...small, marginTop: 6, lineHeight: 1.5 }}>
        Episode and cast data from{" "}
        <a href="https://www.tvmaze.com" target="_blank" rel="noreferrer" style={{ color: CREAM }}>TVMaze</a>{" "}
        (CC BY-SA) and{" "}
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" style={{ color: CREAM }}>TMDB</a>.
        This product uses the TMDB API but is not endorsed or certified by TMDB.
        {ref.wikipediaTitle && (
          <>{" "}Episode summaries from{" "}
            <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(ref.wikipediaTitle)}`} target="_blank" rel="noreferrer" style={{ color: CREAM }}>Wikipedia</a>{" "}
            (CC BY-SA).
          </>
        )}
      </div>

      {/* ── Previously on: watched episodes in full; the rest folded ── */}
      <h2 style={sectionH}>Previously on:</h2>
      {ref.seasons.filter((season) => season.n <= viewerProgress.s).map((season) => {
        const watched = season.episodes.filter((ep) => idx(ep.s, ep.e) <= vIdx);
        const foldedCount = season.episodes.length - watched.length;
        return (
          <div key={season.n} style={{ marginBottom: 28 }}>
            <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 16 : 18, opacity: 0.95, marginBottom: 10 }}>
              Season {season.n}
            </div>
            {watched.map((ep) => (
              <div key={ep.e} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: mobile ? 14 : 15 }}>
                  S{ep.s} E{ep.e} · {ep.title}
                  {ep.airDate && <span style={{ fontWeight: 500, opacity: 0.7 }}>  ·  {ep.airDate}</span>}
                </div>
                {(ep.writers.length > 0 || ep.directors.length > 0 || ep.dp.length > 0) && (
                  <div style={{ ...small, marginTop: 2 }}>
                    {[
                      ep.writers.length ? `written by ${ep.writers.join(", ")}` : null,
                      ep.directors.length ? `directed by ${ep.directors.join(", ")}` : null,
                      ep.dp.length ? `dp ${ep.dp.join(", ")}` : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                )}
                {ep.summary && (
                  <div style={{ fontSize: mobile ? 13 : 14, lineHeight: 1.55, marginTop: 4, opacity: 0.95, maxWidth: 620 }}>
                    {ep.summary}
                  </div>
                )}
              </div>
            ))}
            {foldedCount > 0 && <FoldedStrip count={foldedCount} />}
          </div>
        );
      })}
      {/* Future seasons — shape only. */}
      {ref.seasons.filter((season) => season.n > viewerProgress.s).map((season) => (
        <div key={season.n} style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 16 : 18, opacity: 0.55, marginBottom: 10 }}>
            Season {season.n}
          </div>
          <FoldedStrip count={season.episodes.length} />
        </div>
      ))}

      {/* ── Cast so far ── */}
      {visiblePeople.length > 0 && (
        <>
          <h2 style={sectionH}>Cast so far:</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: mobile ? 14 : 18 }}>
            {visiblePeople.map((p) => (
              <div key={p.name} style={{ width: mobile ? 132 : 150 }}>
                {p.img ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w185${p.img}`}
                    alt=""
                    loading="lazy"
                    style={{ width: mobile ? 64 : 72, height: mobile ? 64 : 72, borderRadius: "50%", objectFit: "cover", border: `2px solid ${CREAM}` }}
                  />
                ) : (
                  <div style={{ width: mobile ? 64 : 72, height: mobile ? 64 : 72, borderRadius: "50%", border: `2px solid ${CREAM}`, opacity: 0.5, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: LORA, fontWeight: 700, fontSize: 24 }}>
                    {p.name[0]}
                  </div>
                )}
                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>{p.name}</div>
                {p.character && <div style={{ fontSize: 12, opacity: 0.9 }}>{p.character}</div>}
                {/* "since …" only once that point is meaningfully behind you
                    (pilot-cast "since S1 E1" is noise). */}
                {idx(p.firstS, p.firstE) > idx(1, 1) && (
                  <div style={{ ...small, marginTop: 2 }}>
                    {p.exact ? `since S${p.firstS} E${p.firstE}` : `since season ${p.firstS}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Trailers: launch + unlocked season trailers + ONE locked tease ── */}
      <h2 style={sectionH}>Trailers:</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 }}>
        {ref.launchTrailerKey && <RefTrailer label="the launch trailer" trailerKey={ref.launchTrailerKey} />}
        {ref.seasons.filter((season) => season.n >= 2 && season.trailerKey).map((season) => {
          const prev = ref.seasons.find((x) => x.n === season.n - 1);
          const prevLast = prev?.episodes[prev.episodes.length - 1];
          const unlocked = !!prevLast && vIdx >= idx(prevLast.s, prevLast.e);
          if (unlocked) return <RefTrailer key={season.n} label={`season ${season.n}`} trailerKey={season.trailerKey!} />;
          // Only the NEXT locked one is teased; deeper seasons stay silent.
          if (season.n === viewerProgress.s + 1) {
            return (
              <div key={season.n} style={{ ...small, fontStyle: "italic" }}>
                the season {season.n} trailer unlocks when you finish season {season.n - 1}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

// The folded shape-only cells — the map's disclosure grammar on this page:
// one small cell per unwatched episode, a quiet dash inside, no contents.
function FoldedStrip({ count }: { count: number }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} aria-hidden style={{ width: 22, height: 28, borderRadius: 6, border: `2px solid ${CANON.cream}`, opacity: 0.35, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 10, height: 2, background: CANON.cream }} />
        </div>
      ))}
    </div>
  );
}

// Inline trailer facade (TrailerCard's thumbnail→iframe pattern, but for a
// KNOWN key from the reference blob).
function RefTrailer({ label, trailerKey }: { label: string; trailerKey: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: CANON.cream, marginBottom: 6 }}>{label}</div>
      <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 14, overflow: "hidden", background: "rgba(0,0,0,0.25)" }}>
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&rel=0`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title="Trailer"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
          />
        ) : (
          <button
            onClick={() => setPlaying(true)}
            aria-label="Play trailer"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", padding: 0, cursor: "pointer", background: "transparent" }}
          >
            <img
              src={`https://i.ytimg.com/vi/${trailerKey}/hqdefault.jpg`}
              loading="lazy"
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
            <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 56, height: 56, borderRadius: "50%", background: "rgba(26,58,74,0.75)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ width: 0, height: 0, borderTop: "10px solid transparent", borderBottom: "10px solid transparent", borderLeft: `16px solid ${CANON.cream}`, marginLeft: 4 }} />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
