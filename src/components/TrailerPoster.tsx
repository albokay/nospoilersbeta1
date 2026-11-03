/**
 * TrailerPoster — the show room's title poster with a play mark (Alborz
 * 2026-10-13): once a trailer resolves for the show, a cream disc with an
 * ink triangle sits on the poster's bottom-right corner and opens the
 * trailer band — the editorial dialog on desktop, the bottom sheet on the
 * phone. Without a trailer the poster is the plain one. The pitched show's
 * opt-in box already carries the band for a friend deciding; this is the
 * way to it from inside the room (the show guide carries it too, from day
 * one). Editorial rooms only — the classic room has no poster by the title.
 */
import { useEffect, useState } from "react";
import { RowPoster, EditorialDialog } from "./editorial/GroupRoom";
import { BottomSheet } from "./editorial/Overlays";
import TrailerCard from "./TrailerCard";
import { getTrailerKeyCached } from "../lib/trailers";
import { fetchTvmazeArt, type TvmazeArt } from "../lib/tvmaze";
import { ensureShowReference } from "../lib/reference";
import { E } from "../styles/editorial";

export default function TrailerPoster({ showId, showName, tvmazeId, w = 0, h = 0, mobile = false, season = null, banner = null, bannerUrl = null }: {
  showId?: string | null; showName?: string | null; tvmazeId?: string | null; w?: number; h?: number; mobile?: boolean;
  /** The phone room's banner (the landing-rule arc's CP2, 2026-11-02): the
   *  show's ORIGINAL art this many px tall across its box, cropped to the
   *  top third, the play mark at the top near the left. */
  banner?: number | null;
  /** The show's landscape art (shows.backdrop_url, CP5 2026-11-02): the banner
   *  shows it when it's there, else the TVMaze original poster cropped. */
  bannerUrl?: string | null;
  /** The season the viewer is on (his note, 2026-11-02): the play mark opens
   *  THAT season's trailer from the show's guide data when it has one
   *  (season 2 on; its first-season trailer is the launch trailer), else
   *  the launch trailer as before. */
  season?: number | null;
}) {
  const [hasTrailer, setHasTrailer] = useState(false);
  // The season's own key, when the guide data has one for the season you're on.
  const [seasonKey, setSeasonKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [art, setArt] = useState<TvmazeArt | null>(null);
  useEffect(() => {
    let cancelled = false;
    setArt(null);
    if (!banner || !tvmazeId || bannerUrl) return;
    fetchTvmazeArt(tvmazeId).then((a) => { if (!cancelled) setArt(a); }).catch(() => { /* the draft block, then */ });
    return () => { cancelled = true; };
  }, [banner, tvmazeId, bannerUrl]);
  useEffect(() => {
    let cancelled = false;
    setHasTrailer(false); setSeasonKey(null);
    if (!showId || !tvmazeId) return;
    getTrailerKeyCached(showId, tvmazeId).then((k) => { if (!cancelled) setHasTrailer(!!k); }).catch(() => { /* no mark */ });
    if (season && season >= 2) {
      ensureShowReference(showId)
        .then((r) => { if (cancelled) return; const k = r?.seasons?.find((x) => x.n === season)?.trailerKey ?? null; if (k) { setSeasonKey(k); setHasTrailer(true); } })
        .catch(() => { /* the launch trailer, then */ });
    }
    return () => { cancelled = true; };
  }, [showId, tvmazeId, season]);
  const title = seasonKey && season ? `${showName ?? "Trailer"} · season ${season}` : (showName ?? "Trailer");
  // The landscape art centred a little high; a portrait poster shows its upper part.
  const landscape = !!(banner && bannerUrl);
  const bannerSrc = banner ? (bannerUrl ?? art?.original ?? art?.medium ?? null) : null;
  const poster = banner
    ? (bannerSrc
      ? <img src={bannerSrc} alt="" draggable={false} style={{ width: "100%", height: banner, objectFit: "cover", objectPosition: landscape ? "50% 40%" : "50% 22%", display: "block" }} />
      : <span aria-hidden="true" style={{ display: "block", width: "100%", height: banner, background: E.color.draft }} />)
    : <RowPoster tvmazeId={tvmazeId} w={w} h={h} />;
  if (!hasTrailer || !showId) return poster;
  const disc = mobile ? 24 : 28;
  return (
    <>
      {/* zIndex 3 (his catch, 2026-10-14): the disc pokes 8px past the poster
          into the tabs row's box below, a positioned sibling drawn later —
          without a z-index that transparent box took the disc's clicks. */}
      <button type="button" onClick={() => setOpen(true)} aria-label="Watch the trailer" title="Watch the trailer" style={{ position: "relative", zIndex: 3, display: "block", width: banner ? "100%" : undefined, padding: 0, border: 0, background: "transparent", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
        {poster}
        <span aria-hidden="true" style={{ position: "absolute", ...(banner ? { left: 16, top: -12 } : { right: -8, bottom: -8 }), width: disc, height: disc, borderRadius: "50%", background: E.color.cream, border: `1px solid ${E.color.ink}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width={mobile ? 9 : 10} height={mobile ? 9 : 10} viewBox="0 0 10 10" style={{ marginLeft: 1 }}><path d="M2 1 L9 5 L2 9 Z" fill={E.color.ink} /></svg>
        </span>
      </button>
      {open && (mobile ? (
        <BottomSheet onClose={() => setOpen(false)} title={title} pad={false} label="Trailer">
          <div style={{ marginTop: 14 }}><TrailerCard showId={showId} tvmazeId={tvmazeId} trailerKey={seasonKey} bleed={0} foot="calc(env(safe-area-inset-bottom, 0px) + 24px)" /></div>
        </BottomSheet>
      ) : (
        <EditorialDialog onClose={() => setOpen(false)} width={560} label="Trailer" align="left">
          <div style={{ ...E.type.letterTitle22, paddingRight: 28 }}>{title}</div>
          <div style={{ marginTop: 18 }}><TrailerCard showId={showId} tvmazeId={tvmazeId} trailerKey={seasonKey} bleed={32} foot="32px" /></div>
        </EditorialDialog>
      ))}
    </>
  );
}
