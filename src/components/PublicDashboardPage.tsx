/**
 * PublicDashboardPage — a read-only, public view of another user's show pool,
 * styled like the green dashboard. Reached from the show room when you click a
 * member's name (/pool/:username). No groups, chat, private writing, search,
 * or editing — just "here's what they're watching." Public data only
 * (fetchPublicProgressForUser), so it works logged-out; logged-out visitors
 * get a "sign in" button where the dashboard shows "invite friends".
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../lib/auth";
import {
  fetchShows, fetchPublicProfileByUsername, fetchPublicProgressForUser,
  type Show,
} from "../lib/db";
import type { ProgressEntry } from "../types";
import SidebarLogo from "./SidebarLogo";
import { CANON } from "../styles/canon";

const C = { green: CANON.personal, sky: CANON.friend, blue: CANON.identity, yellow: CANON.accent, cream: CANON.cream, midnight: CANON.dark };
const LORA = '"Lora", Georgia, serif';

// `invite` turns the page into the email-invite arrival screen: no back arrow,
// "@X wants to watch these shows:" / "and is already watching these:" headings
// (wants first), and a "Want to watch something with them? / JOIN IN" footer
// instead of the watch-pool title + sign-in CTA. Same data + styling as /pool.
export default function PublicDashboardPage({ username, invite }: { username: string; invite?: { onJoin: () => void } }) {
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
        console.error("[public-dashboard] load failed", e);
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

  // Pool = the user's shows split into watching (started) / haven't-started.
  // Stopped shows are excluded (not part of the watch pool).
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

  if (loading) return <div style={{ ...pageStyle, background: C.green }} aria-busy="true" />;

  return (
    <div style={{ ...pageStyle, background: C.green }}>
      {/* Back-to-where-you-came-from tab — cream edge pill (mirrors the rooms).
          Hidden on the invite arrival screen (nowhere to go back to). */}
      {!invite && (
        <button style={backTab} title="back" onClick={() => navigate(-1)}>
          <ArrowLeft size={24} color={C.green} />
        </button>
      )}

      <div style={topBar}>
        <SidebarLogo scale={0.5} blocksOpacity={1} />
      </div>

      {notFound ? (
        <div style={{ textAlign: "center", marginTop: 80, color: C.cream, fontFamily: LORA, fontSize: 24, fontWeight: 700 }}>
          We couldn&rsquo;t find that person.
        </div>
      ) : invite ? (
        <div style={contentWrap}>
          {notStarted.length > 0 && (
            <>
              <h2 style={inviteHeading}><span style={{ color: C.cream }}>@{username}</span> wants to watch these shows:</h2>
              <div style={inviteShelfLayout(notStarted.length)}>
                {notStarted.map(({ show }) => (
                  <div key={show.id} style={{ ...pill, ...pillWant }}><span style={pillName}>{show.name}</span></div>
                ))}
              </div>
            </>
          )}
          {watching.length > 0 && (
            <>
              <h2 style={{ ...inviteHeading, marginTop: notStarted.length ? 64 : 0 }}>
                {notStarted.length > 0
                  ? "and is already watching these:"
                  : <><span style={{ color: C.cream }}>@{username}</span> is watching these shows:</>}
              </h2>
              <div style={inviteShelfLayout(watching.length)}>
                {watching.map(({ show, entry }) => (
                  <div key={show.id} style={{ ...pill, ...pillWatching }}>
                    <span style={pillName}>{show.name}</span>
                    <span style={pillProg}>s{entry.s} e{entry.e}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div style={{ textAlign: "center", marginTop: 72 }}>
            <h2 style={{ ...heading, color: C.cream, margin: "0 0 4px" }}>Want to watch something with them?</h2>
            <div style={{ color: C.cream, fontSize: 15, marginBottom: 28 }}>(or propose something else?)</div>
            <button style={signInPill} onClick={invite.onJoin}>JOIN IN</button>
          </div>
        </div>
      ) : (
        <div style={contentWrap}>
          <h1 style={heading}><span style={{ color: C.cream }}>@{username}</span>&rsquo;s watch pool:</h1>

          {watching.length > 0 && (
            <>
              <h2 style={shelfHeader}>CURRENTLY WATCHING</h2>
              <div style={shelfLayout(watching.length)}>
                {watching.map(({ show, entry }) => (
                  <div key={show.id} style={{ ...pill, ...pillWatching }}>
                    <span style={pillName}>{show.name}</span>
                    <span style={pillProg}>s{entry.s} e{entry.e}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {notStarted.length > 0 && (
            <>
              <h2 style={{ ...shelfHeader, textTransform: "none", marginTop: watching.length ? 48 : 0 }}>Haven&rsquo;t started yet</h2>
              <div style={shelfLayout(notStarted.length)}>
                {notStarted.map(({ show }) => (
                  <div key={show.id} style={{ ...pill, ...pillWant }}>
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

          {/* Logged-out visitors get a sign-in CTA where signed-in users see
              "invite friends" on their own dashboard. */}
          {!user && (
            <div style={{ textAlign: "center", marginTop: 64 }}>
              <button style={signInPill} onClick={() => navigate("/")}>SIGN IN</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  position: "fixed", inset: 0, overflowY: "auto", fontFamily: '"Inter", system-ui, sans-serif',
};
const backTab: React.CSSProperties = {
  position: "fixed", left: 0, top: "18%", background: C.cream, border: "none", cursor: "pointer",
  borderTopRightRadius: 28, borderBottomRightRadius: 28, padding: "16px 22px 16px 14px",
  display: "inline-flex", alignItems: "center", boxShadow: "6px 6px 18px rgba(0,0,0,0.15)", zIndex: 45,
};
const topBar: React.CSSProperties = {
  display: "flex", alignItems: "center", padding: "20px 28px",
};
const contentWrap: React.CSSProperties = { maxWidth: 1040, margin: "0 auto", padding: "8px 64px 80px" };
const heading: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: 0, color: CANON.cream,
  textAlign: "center", margin: "8px 0 40px",
};
const shelfHeader: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 30, letterSpacing: 0, color: C.cream,
  textAlign: "center", textTransform: "uppercase", margin: "0 0 24px",
};
// Invite arrival screen: centered sentence headings + left-anchored shelves.
const inviteHeading: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: 0, color: C.cream,
  textAlign: "center", margin: "0 0 24px",
};
const inviteShelf: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px 16px", maxWidth: 880, margin: 0,
};
// 1–2 shows center (matching the dashboard rule); 3+ keep the left-anchored
// 3-col grid that sits under the left-aligned invite headings.
function inviteShelfLayout(count: number): React.CSSProperties {
  if (count >= 3) return inviteShelf;
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${Math.max(count, 1)}, ${SHELF_COL}px)`,
    gap: "24px 16px", justifyContent: "center", maxWidth: 880, margin: "0 auto",
  };
}
const shelfGrid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", maxWidth: 880, margin: "0 auto",
};
// 1–2 shows center at the 3-col column width; 3+ lock into the 3-col grid
// (matches the dashboard's shelf layout).
const SHELF_COL = 283;
function shelfLayout(count: number): React.CSSProperties {
  if (count >= 3) return shelfGrid;
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${Math.max(count, 1)}, ${SHELF_COL}px)`,
    gap: "24px 16px", justifyContent: "center", maxWidth: 880, margin: "0 auto",
  };
}
const pill: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
  padding: "14px 24px", borderRadius: 65, fontFamily: '"Inter", sans-serif',
  fontWeight: 700, fontSize: 14, letterSpacing: -1, boxSizing: "border-box",
};
const pillWatching: React.CSSProperties = { background: "transparent", border: `2px solid ${C.cream}`, color: C.cream };
const pillWant: React.CSSProperties = { background: C.cream, border: `2px solid ${C.cream}`, color: C.green };
const pillName: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const pillProg: React.CSSProperties = { fontWeight: 500, opacity: 0.8 };
const signInPill: React.CSSProperties = {
  border: "none", background: C.blue, color: CANON.cream, fontWeight: 800, fontSize: 14,
  letterSpacing: 0.5, padding: "20px 72px", borderRadius: 65, cursor: "pointer",
  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};
