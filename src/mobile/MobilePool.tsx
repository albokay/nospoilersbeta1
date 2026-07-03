import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { CANON } from "../styles/canon";
import { useAuth } from "../lib/auth";
import SidebarLogo from "../components/SidebarLogo";
import {
  fetchShows, fetchPublicProfileByUsername, fetchPublicProgressForUser,
  type Show,
} from "../lib/db";
import type { ProgressEntry } from "../types";

/**
 * MobilePool — read-only view of a person's watch pool, single column.
 * Mobile re-expression of the desktop PublicDashboardPage's non-invite
 * branch (same data calls + copy); reached by tapping a member's name in
 * a show-room feed (desktop's byline click → /pool/:username). Back pops
 * to wherever you came from (the room), like desktop's edge tab.
 */

const C = { green: CANON.personal, cream: CANON.cream, blue: CANON.identity };
const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export default function MobilePool({ username }: { username: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const prof = await fetchPublicProfileByUsername(username);
        if (!prof) { if (!cancelled) { setNotFound(true); setLoading(false); } return; }
        const [allShows, prog] = await Promise.all([fetchShows(), fetchPublicProgressForUser(prof.id)]);
        if (cancelled) return;
        setShows(allShows);
        setProgress(prog);
      } catch (e) {
        console.error("[m-pool] load failed", e);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [username]);

  const showsById = useMemo(() => {
    const m: Record<string, Show> = {};
    for (const s of shows) m[s.id] = s;
    return m;
  }, [shows]);

  const { watching, notStarted } = useMemo(() => {
    const w: { show: Show; entry: ProgressEntry }[] = [];
    const n: { show: Show; entry: ProgressEntry }[] = [];
    for (const [showId, entry] of Object.entries(progress)) {
      const show = showsById[showId];
      if (!show || show.isHidden) continue;
      if (entry.stoppedWatching) continue;
      const started = (entry.s ?? 0) > 0 || (entry.e ?? 0) > 0;
      (started ? w : n).push({ show, entry });
    }
    const byName = (a: { show: Show }, b: { show: Show }) => a.show.name.localeCompare(b.show.name);
    return { watching: w.sort(byName), notStarted: n.sort(byName) };
  }, [progress, showsById]);

  if (loading) return <div style={{ ...page, background: C.green }} aria-busy="true" />;

  return (
    <div style={{ ...page, background: C.green }}>
      <div style={topBar}>
        <button style={iconBtn} title="back" onClick={() => navigate(-1)}>
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
          <h1 style={heading}><span style={{ color: C.cream }}>@{username}</span>&rsquo;s watch pool:</h1>

          {watching.length > 0 && (
            <>
              <h2 style={shelfHeader}>CURRENTLY WATCHING</h2>
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

          {notStarted.length > 0 && (
            <>
              <h2 style={{ ...shelfHeader, textTransform: "none", marginTop: watching.length ? 40 : 0 }}>Haven&rsquo;t started yet</h2>
              <div style={shelfCol}>
                {notStarted.map(({ show }) => (
                  <div key={show.id} style={{ ...pill, background: C.cream, color: C.green }}>
                    <span style={pillName}>{show.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {watching.length === 0 && notStarted.length === 0 && (
            <div style={{ textAlign: "center", color: C.cream, opacity: 0.85, marginTop: 24 }}>
              @{username} hasn&rsquo;t added any shows yet.
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
