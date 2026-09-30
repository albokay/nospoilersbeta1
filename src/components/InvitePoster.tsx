import React, { useEffect, useState } from "react";
import { fetchTvmazePoster } from "../lib/tvmaze";
import { CANON } from "../styles/canon";

// The invite wall's show thumbnail (Alborz 2026-09-28): on the invited
// friend's landing — and only there — the inviter's shows are poster
// thumbnails in the browse rows' geometry (196×277 desktop, 128×181 /m)
// instead of name pills. Posters resolve from TVMaze on demand (module-
// cached in lib/tvmaze); a show with no TVMaze id, or a miss, renders the
// caller's pill instead. Clickable only when the caller has something to
// open behind it (a trailer); otherwise a plain poster.
export default function InvitePoster({ tvmazeId, name, idiom, caption, onOpen, fallback, pinned = false }: {
  tvmazeId?: string | number | null;
  name: string;
  idiom: "desktop" | "mobile";
  /** e.g. the inviter's "s1 e4" on the already-watching shelf. */
  caption?: string;
  onOpen?: () => void;
  /** Rendered when no poster can be had. */
  fallback: React.ReactNode;
  /** The inviter's PROPOSED shows (Alborz 2026-09-30): a tilted pin — cream
   *  outline, Personal green fill — rides the top edge right of centre,
   *  partly off the poster, over the page behind it. */
  pinned?: boolean;
}) {
  // undefined = resolving, null = miss, string = hit.
  const [url, setUrl] = useState<string | null | undefined>(tvmazeId ? undefined : null);
  useEffect(() => {
    if (!tvmazeId) { setUrl(null); return; }
    let cancelled = false;
    setUrl(undefined);
    fetchTvmazePoster(tvmazeId)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; };
  }, [tvmazeId]);

  if (url === null) return <>{fallback}</>;

  const m = idiom === "mobile";
  const w = m ? 128 : 196, h = m ? 181 : 277;
  const box: React.CSSProperties = {
    width: w, height: h, borderRadius: 4, overflow: "hidden", padding: 0, border: "none",
    background: "rgba(253,248,236,0.12)", display: "block", flexShrink: 0,
  };
  const img = url
    ? <img src={url} alt="" loading="lazy" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    : null; // resolving: the box holds its place so the shelf doesn't jump
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: w }}>
      {pinned && (
        <span aria-hidden style={{ position: "absolute", top: m ? -9 : -12, left: "64%", transform: "rotate(18deg)", zIndex: 2, pointerEvents: "none", lineHeight: 0 }}>
          {/* lucide "pin", filled */}
          <svg width={m ? 22 : 28} height={m ? 22 : 28} viewBox="0 0 24 24" fill={CANON.personal} stroke={CANON.cream} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
        </span>
      )}
      {onOpen
        ? <button type="button" onClick={onOpen} title={name} aria-label={`${name} — watch the trailer`} style={{ ...box, cursor: "pointer" }}>{img}</button>
        : <div role="img" aria-label={name} style={box}>{img}</div>}
      {caption && (
        <span style={{ fontFamily: '"Inter", sans-serif', fontWeight: 500, fontSize: 13, lineHeight: 1.3, color: CANON.cream, opacity: 0.85 }}>{caption}</span>
      )}
    </div>
  );
}
