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
  fetchShows, fetchPublicProfileByUsername, fetchPublicProgressForUser, fetchContactNames,
  fetchPublicPool, fetchInvitePool, type PublicPoolShow,
  type Show,
} from "../lib/db";
import type { ProgressEntry } from "../types";
import SidebarLogo from "./SidebarLogo";
import InviteShowSuggest from "./InviteShowSuggest";
import FeedbackWidget from "./FeedbackWidget";
import { CANON } from "../styles/canon";

const C = { green: CANON.personal, sky: CANON.friend, blue: CANON.identity, yellow: CANON.accent, cream: CANON.cream, midnight: CANON.dark };
const LORA = '"Lora", Georgia, serif';

// `invite` turns the page into the email-invite arrival screen: no back arrow,
// "@X wants to watch these shows:" / "and is already watching these:" headings
// (wants first), and a "Want to watch something with them? / JOIN IN" footer
// instead of the watch-pool title + sign-in CTA. Same data + styling as /pool.
export default function PublicDashboardPage({ username, invite, displayNameOverride }: { username: string; invite?: { onJoin: () => void; token?: string }; displayNameOverride?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  // Naming arc (2026-07-07): a signed-in viewer sees THEIR given name for the
  // pool's owner (handle fallback); logged-out visitors have no contacts and
  // keep the handle. Display-only — the route stays keyed by username.
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
          // Invite arrival: GROUP-scoped shelves (Alborz 2026-08-13) — the
          // inviter's votes/rooms within the invited group only, not their
          // whole cross-group pool. Falls back pre-migration.
          invite?.token
            ? fetchInvitePool(invite.token).then((p) => p ?? fetchPublicPool(prof.id))
            : fetchPublicPool(prof.id),
        ]);
        if (cancelled) return;
        setShows(allShows);
        setProgress(prog);
        setPool(pp);
        // Name chain (CP2): the viewer's contact name → the owner's self-chosen
        // first name (public — anon visitors see it too) → null (handle below).
        setDisplayName(cn[prof.id] ?? prof.displayName ?? null);
      } catch (e) {
        console.error("[public-dashboard] load failed", e);
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

  // Opt-in-based shelves (2026-07-07, Alborz):
  //   interested = live yes-votes in any of their groups (minus left rooms)
  //   watching   = shows with an open room they're currently in
  // Watch progress alone no longer surfaces a show (consistent with the
  // group-scoped model). Pre-migration fallback: the old progress-derived
  // split (started → watching, not-started → interested).
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

  if (loading) return <div style={{ ...pageStyle, background: C.green }} aria-busy="true" />;

  // How the pool's owner is named. An explicit override (the inviter's
  // first name off the invite, passed on the logged-out arrival where no
  // viewer contacts exist) wins; then contact name → the owner's first name
  // (CP2); else the @handle — a last resort that stops firing once every
  // account has a display_name. Bare name — no "@" once a real name resolves.
  const ownerName = displayNameOverride ?? displayName ?? `@${username}`;

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
        <>
        {/* The shelves stay in the 1040 column; the suggest block (which now
            carries the full-width browse rows, 2026-08-18) and the JOIN
            cluster render OUTSIDE it — both are centered content anyway, and
            the rows' 5½-poster window needs the whole viewport. */}
        <div style={{ ...contentWrap, paddingBottom: 0 }}>
          {/* Same shelf copy as /pool (2026-07-07): interested-in-starting
              (opted-in proposals) first, open-room shows second. */}
          {interested.length > 0 && (
            <>
              {/* QA round 6: invitee-facing framing, singular-safe. */}
              <h2 style={inviteHeading}><span style={{ color: C.cream }}>{ownerName}</span> wants to watch {interested.length === 1 ? "this show" : "these shows"} with you:</h2>
              <div style={inviteShelfLayout(interested.length)}>
                {interested.map(({ show }) => (
                  <div key={show.id} style={{ ...pill, ...pillWant }}><span style={pillName}>{show.name}</span></div>
                ))}
              </div>
            </>
          )}
          {watching.length > 0 && (
            <>
              <h2 style={{ ...inviteHeading, marginTop: interested.length ? 64 : 0 }}>
                {/* Singular-safe (Alborz 2026-08-01 — matches the wants shelf). */}
                {interested.length > 0
                  ? (watching.length === 1 ? "and is already watching this:" : "and is already watching these:")
                  : <><span style={{ color: C.cream }}>{ownerName}</span> is already watching {watching.length === 1 ? "this show" : "these shows"}:</>}
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
        </div>
        {/* The invitee can suggest shows RIGHT HERE (Alborz 2026-08-01) —
            picks park per-token and become proposals on accept. The old
            "(You can also propose other shows.)" parenthetical retired
            with it — the block's own "(You can also do this later.)"
            carries that message now. The inviter's shows above are hidden
            from the block's browse rows. */}
        {invite.token && (
          <InviteShowSuggest
            token={invite.token}
            idiom="desktop"
            excludeTvmazeIds={new Set([...interested, ...watching].map(({ show }) => Number(show.tvmazeId)).filter((n) => !!n))}
          >
            {/* Button directly under the search bar, tail line under it so
                the pair reads as one sentence (Alborz 2026-08-11); ABOVE the
                browse rows (Alborz 2026-08-18). */}
            <div style={{ textAlign: "center", marginTop: 28 }}>
              <button style={signInPill} onClick={invite.onJoin}>JOIN YOUR FRIEND</button>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 24, color: C.cream, marginTop: 14 }}>&hellip;and start writing.</div>
            </div>
          </InviteShowSuggest>
        )}
        <div style={{ paddingBottom: 80 }} />
        </>
      ) : (
        <div style={contentWrap}>
          <h1 style={heading}><span style={{ color: C.cream }}>{ownerName}</span>&rsquo;s watch pool:</h1>

          {/* Same shelf copy as the invite arrival (2026-07-07): interested-
              in-starting (opted-in proposals) first, open-room shows second. */}
          {interested.length > 0 && (
            <>
              <h2 style={{ ...shelfHeader, textTransform: "none" }}>
                <span style={{ color: C.cream }}>{ownerName}</span> is interested in starting these shows:
              </h2>
              <div style={shelfLayout(interested.length)}>
                {interested.map(({ show }) => (
                  <div key={show.id} style={{ ...pill, ...pillWant }}>
                    <span style={pillName}>{show.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {watching.length > 0 && (
            <>
              <h2 style={{ ...shelfHeader, textTransform: "none", marginTop: interested.length ? 48 : 0 }}>
                {interested.length > 0
                  ? "and is already watching these:"
                  : <><span style={{ color: C.cream }}>{ownerName}</span> is already watching these shows:</>}
              </h2>
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

          {watching.length === 0 && interested.length === 0 && (
            <div style={{ textAlign: "center", color: C.cream, opacity: 0.85, marginTop: 24 }}>
              {ownerName} hasn&rsquo;t added any shows yet.
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

      {/* Feedback tab — left-edge widget on every live desktop surface
          (2026-07-03). Supports anon submissions, so the signed-out invite
          arrival gets it too. */}
      <FeedbackWidget isMobile={typeof window !== "undefined" && window.innerWidth <= 600} />
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
