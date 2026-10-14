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
import { E } from "../styles/editorial";

export default function TrailerPoster({ showId, showName, tvmazeId, w, h, mobile = false }: {
  showId?: string | null; showName?: string | null; tvmazeId?: string | null; w: number; h: number; mobile?: boolean;
}) {
  const [hasTrailer, setHasTrailer] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHasTrailer(false);
    if (!showId || !tvmazeId) return;
    getTrailerKeyCached(showId, tvmazeId).then((k) => { if (!cancelled) setHasTrailer(!!k); }).catch(() => { /* no mark */ });
    return () => { cancelled = true; };
  }, [showId, tvmazeId]);
  const poster = <RowPoster tvmazeId={tvmazeId} w={w} h={h} />;
  if (!hasTrailer || !showId) return poster;
  const disc = mobile ? 24 : 28;
  return (
    <>
      {/* zIndex 3 (his catch, 2026-10-14): the disc pokes 8px past the poster
          into the tabs row's box below, a positioned sibling drawn later —
          without a z-index that transparent box took the disc's clicks. */}
      <button type="button" onClick={() => setOpen(true)} aria-label="Watch the trailer" title="Watch the trailer" style={{ position: "relative", zIndex: 3, display: "block", padding: 0, border: 0, background: "transparent", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
        {poster}
        <span aria-hidden="true" style={{ position: "absolute", right: -8, bottom: -8, width: disc, height: disc, borderRadius: "50%", background: E.color.cream, border: `1px solid ${E.color.ink}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width={mobile ? 9 : 10} height={mobile ? 9 : 10} viewBox="0 0 10 10" style={{ marginLeft: 1 }}><path d="M2 1 L9 5 L2 9 Z" fill={E.color.ink} /></svg>
        </span>
      </button>
      {open && (mobile ? (
        <BottomSheet onClose={() => setOpen(false)} title={showName ?? "Trailer"} pad={false} label="Trailer">
          <div style={{ marginTop: 14 }}><TrailerCard showId={showId} tvmazeId={tvmazeId} bleed={0} foot="calc(env(safe-area-inset-bottom, 0px) + 24px)" /></div>
        </BottomSheet>
      ) : (
        <EditorialDialog onClose={() => setOpen(false)} width={560} label="Trailer" align="left">
          <div style={{ ...E.type.letterTitle22, paddingRight: 28 }}>{showName ?? "Trailer"}</div>
          <div style={{ marginTop: 18 }}><TrailerCard showId={showId} tvmazeId={tvmazeId} bleed={32} foot="32px" /></div>
        </EditorialDialog>
      ))}
    </>
  );
}
