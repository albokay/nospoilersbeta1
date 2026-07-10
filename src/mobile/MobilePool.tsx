import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { CANON } from "../styles/canon";
import { useAuth } from "../lib/auth";
import SidebarLogo from "../components/SidebarLogo";
import LoadingDots from "../components/LoadingDots";
import {
  fetchShows, fetchPublicProfileByUsername, fetchPublicProgressForUser, fetchContactNames,
  fetchPublicPool, type PublicPoolShow,
  type Show,
} from "../lib/db";
import type { ProgressEntry } from "../types";

/**
 * MobilePool — read-only view of a person's watch pool, single column.
 * Mobile re-expression of the desktop PublicDashboardPage's non-invite
 * branch (same data calls + copy).
 *
 * Two mounts:
 *   • Route (/m/pool/:username) — a full page; back pops history.
 *   • OVERLAY (from a show-room byline tap) — renders on TOP of the
 *     still-mounted room with `overlay` + `onBack`. The room pushes a
 *     history entry when opening, so the iOS edge-swipe (a history pop)
 *     closes the overlay and reveals the room exactly as it was — same
 *     expanded ticket, same scroll, no refetch (the "stable back swipe").
 */

const C = { green: CANON.personal, cream: CANON.cream, blue: CANON.identity };
const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export default function MobilePool({ username, overlay = false, onBack }: { username: string; overlay?: boolean; onBack?: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  // The viewer's contact name for the pool's owner (naming arc 2026-07-07,
  // desktop parity): signed-in viewers see THEIR name for the person; anon
  // (and unnamed) keeps the @handle.
  const [displayName, setDisplayName] = useState<string | null>(null);
  // Opt-in-based shelves (2026-07-07): proposals + open rooms from the new
  // RPC; null pre-migration → the old progress-derived split below.
  const [pool, setPool] = useState<{ proposals: PublicPoolShow[]; rooms: PublicPoolShow[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const prof = await fetchPublicProfileByUsername(username);
        if (!prof) { if (!cancelled) { setNotFound(true); setLoading(false); } return; }
        const [allShows, prog, cn, pp] = await Promise.all([
          fetchShows(),
          fetchPublicProgressForUser(prof.id),
          user ? fetchContactNames(user.id).catch(() => ({} as Record<string, string>)) : Promise.resolve({} as Record<string, string>),
          fetchPublicPool(prof.id),
        ]);
        if (cancelled) return;
        setShows(allShows);
        setProgress(prog);
        setPool(pp);
        // Name chain (CP2): viewer's contact name → the owner's self-chosen
        // first name (public — anon visitors see it too) → null (handle below).
        setDisplayName(cn[prof.id] ?? prof.displayName ?? null);
      } catch (e) {
        console.error("[m-pool] load failed", e);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [username, user?.id]);

  const showsById = useMemo(() => {
    const m: Record<string, Show> = {};
    for (const s of shows) m[s.id] = s;
    return m;
  }, [shows]);

  // Opt-in-based shelves (2026-07-07, desktop parity): interested = live
  // yes-votes anywhere (minus left rooms); watching = open rooms they're in.
  // Progress alone no longer surfaces a show. Pre-migration fallback: the
  // old progress-derived split.
  const { watching, interested } = useMemo(() => {
    const byName = (a: { show: Show }, b: { show: Show }) => a.show.name.localeCompare(b.show.name);
    if (pool) {
      const map = (rows: PublicPoolShow[]) => rows
        .map((r) => ({ show: showsById[r.showId], entry: { s: r.s, e: r.e } as ProgressEntry }))
        .filter((x): x is { show: Show; entry: ProgressEntry } => !!x.show && !x.show.isHidden)
        .sort(byName);
      // s0e0 room shows (haven't started) belong on the "interested in
      // starting" shelf, not "already watching" (Alborz 2026-07-08).
      const started = (r: PublicPoolShow) => (r.s ?? 0) > 0 || (r.e ?? 0) > 0;
      return {
        watching: map(pool.rooms.filter(started)),
        interested: map([...pool.proposals, ...pool.rooms.filter((r) => !started(r))]),
      };
    }
    const w: { show: Show; entry: ProgressEntry }[] = [];
    const n: { show: Show; entry: ProgressEntry }[] = [];
    for (const [showId, entry] of Object.entries(progress)) {
      const show = showsById[showId];
      if (!show || show.isHidden) continue;
      if (entry.stoppedWatching) continue;
      const started = (entry.s ?? 0) > 0 || (entry.e ?? 0) > 0;
      (started ? w : n).push({ show, entry });
    }
    return { watching: w.sort(byName), interested: n.sort(byName) };
  }, [pool, progress, showsById]);

  const goBack = onBack ?? (() => navigate(-1));
  const rootStyle: React.CSSProperties = overlay
    ? { ...page, background: C.green, position: "fixed", inset: 0, zIndex: 1500, overflowY: "auto", WebkitOverflowScrolling: "touch" }
    : { ...page, background: C.green };

  if (loading) {
    return (
      <div style={{ ...rootStyle, display: "flex", alignItems: "center", justifyContent: "center" }} aria-busy="true">
        {/* Standard loading line: "loading" + ellipses, Header 2, cream. */}
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: C.cream }}>loading<LoadingDots /></span>
      </div>
    );
  }

  return (
    <div style={rootStyle}>
      <div style={topBar}>
        <button style={iconBtn} title="back" onClick={goBack}>
          <ArrowLeft size={22} color={C.cream} />
        </button>
        <SidebarLogo scale={0.5} blocksOpacity={1} />
      </div>

      {notFound ? (
        <div style={{ textAlign: "center", marginTop: 80, color: C.cream, fontFamily: LORA, fontSize: 24, fontWeight: 700, padding: "0 24px" }}>
          We couldn&rsquo;t find that person.
        </div>
      ) : (
        <div style={{ padding: "8px 16px 48px" }}>
          <h1 style={heading}><span style={{ color: C.cream }}>{displayName ?? `@${username}`}</span>&rsquo;s watch pool:</h1>

          {/* Same shelf copy as desktop + the invite arrival (2026-07-07):
              interested-in-starting first, open-room shows second. */}
          {interested.length > 0 && (
            <>
              <h2 style={{ ...shelfHeader, textTransform: "none" }}>
                <span style={{ color: C.cream }}>{displayName ?? `@${username}`}</span> is interested in starting these shows:
              </h2>
              <div style={shelfCol}>
                {interested.map(({ show }) => (
                  <div key={show.id} style={{ ...pill, background: C.cream, color: C.green }}>
                    <span style={pillName}>{show.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {watching.length > 0 && (
            <>
              <h2 style={{ ...shelfHeader, textTransform: "none", marginTop: interested.length ? 40 : 0 }}>
                {interested.length > 0
                  ? "and is already watching these:"
                  : <><span style={{ color: C.cream }}>{displayName ?? `@${username}`}</span> is already watching these shows:</>}
              </h2>
              <div style={shelfCol}>
                {watching.map(({ show, entry }) => (
                  <div key={show.id} style={{ ...pill, background: "transparent", border: `2px solid ${C.cream}`, color: C.cream }}>
                    <span style={pillName}>{show.name}</span>
                    <span style={{ fontWeight: 500 }}>s{entry.s} e{entry.e}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {watching.length === 0 && interested.length === 0 && (
            <div style={{ textAlign: "center", color: C.cream, opacity: 0.85, marginTop: 24 }}>
              {displayName ?? `@${username}`} hasn&rsquo;t added any shows yet.
            </div>
          )}

          {/* Logged-out visitors get a sign-in CTA (desktop parity). */}
          {!user && (
            <div style={{ textAlign: "center", marginTop: 56 }}>
              <button style={signInPill} onClick={() => navigate("/m")}>SIGN IN</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const page: React.CSSProperties = {
  minHeight: "100dvh", boxSizing: "border-box",
  fontFamily: '"Inter", system-ui, sans-serif',
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
};
const topBar: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "calc(env(safe-area-inset-top, 0px) + 12px) 12px 8px",
};
const iconBtn: React.CSSProperties = {
  width: 44, height: 44, flexShrink: 0, border: "none", background: "transparent", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const heading: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 26, letterSpacing: 0, color: C.cream,
  textAlign: "center", margin: "8px 0 28px",
};
const shelfHeader: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 22, letterSpacing: 0, color: C.cream,
  textAlign: "center", textTransform: "uppercase", margin: "0 0 16px",
};
const shelfCol: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const pill: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 12, padding: "14px 24px", borderRadius: 65,
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14,
  letterSpacing: -1, width: "100%", boxSizing: "border-box", minHeight: 48,
};
const pillName: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const signInPill: React.CSSProperties = {
  border: "none", background: C.blue, color: C.cream, fontWeight: 800, fontSize: 16,
  padding: "16px 56px", borderRadius: 65, cursor: "pointer", minHeight: 52,
  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};
