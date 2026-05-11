import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "../../lib/auth";
import {
  fetchShows,
  fetchProgress,
  fetchPublicProfileByUsername,
  fetchPublicProgressForUser,
  fetchPublicThreadsForUser,
  fetchSharedRoomsForUsers,
} from "../../lib/db";
import type { Show, SharedRoomRow } from "../../lib/db";
import type { ProgressEntry, Thread } from "../../types";
import V2Layout from "./V2Layout";

// Same shared profile-card style as V2ProfileSelfPage — sharp corners,
// transparent fill, 2px white outline. The visitor view mirrors the
// owner's visual language exactly. (Duplicated rather than imported to
// keep each file self-contained; if a third surface ever needs it,
// lift to a shared helper.)
const PROFILE_CARD: React.CSSProperties = {
  background: "transparent",
  border: "2px solid #fff",
  borderRadius: 0,
  boxShadow: "none",
};
import { navigateToShow } from "./v2nav";

type ShelfStatus = "watching" | "want" | "finished" | "stopped";

function classifyShow(p: ProgressEntry, show: Show | undefined): ShelfStatus {
  if (p.stoppedWatching) return "stopped";
  if (p.s === 0 && p.e === 0) return "want";
  if (show?.seasons && show.seasons.length > 0) {
    const finalS = show.seasons.length;
    const finalE = show.seasons[finalS - 1];
    const checkS = p.isRewatching ? (p.highestS ?? p.s) : p.s;
    const checkE = p.isRewatching ? (p.highestE ?? p.e) : p.e;
    if (checkS >= finalS && checkE >= finalE) return "finished";
  }
  return "watching";
}

function progressShort(p: ProgressEntry): string {
  if (p.s === 0 && p.e === 0) return "haven't started";
  return `S${String(p.s).padStart(2, "0")} E${String(p.e).padStart(2, "0")}`;
}

export default function V2ProfileVisitorPage({ username }: { username: string }) {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();

  // Self-visiting via /v2/u/:username → bounce to the self page so edit
  // affordances work. Caught early so we don't render the read-only
  // shape for our own profile.
  useEffect(() => {
    if (profile?.username && profile.username === username) {
      navigate("/v2/profile", { replace: true });
    }
  }, [profile?.username, username, navigate]);

  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [shows, setShows] = useState<Show[]>([]);
  const [ownerProgress, setOwnerProgress] = useState<Record<string, ProgressEntry>>({});
  const [ownerPublicThreads, setOwnerPublicThreads] = useState<Thread[]>([]);
  const [visitorProgress, setVisitorProgress] = useState<Record<string, ProgressEntry>>({});
  const [sharedRooms, setSharedRooms] = useState<SharedRoomRow[]>([]);
  // Owner's bio — read-only on the visitor view. Populated from
  // fetchPublicProfileByUsername (extended in commit D to return bio).
  const [ownerBio, setOwnerBio] = useState<string | null>(null);

  // Bootstrap owner data — works for logged-out visitors too.
  useEffect(() => {
    let cancelled = false;
    setNotFound(false);
    setOwnerId(null);
    fetchPublicProfileByUsername(username)
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setNotFound(true);
          return;
        }
        setOwnerId(p.id);
        setOwnerBio(p.bio);
        return Promise.all([
          fetchShows(),
          fetchPublicProgressForUser(p.id),
          fetchPublicThreadsForUser(p.id),
        ]).then(([allShows, prog, threads]) => {
          if (cancelled) return;
          setShows(allShows);
          setOwnerProgress(prog);
          setOwnerPublicThreads(threads);
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2ProfileVisitorPage owner load failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Visitor-side bootstrap — only runs when logged in.
  useEffect(() => {
    if (!user || !ownerId) {
      setVisitorProgress({});
      setSharedRooms([]);
      return;
    }
    let cancelled = false;
    Promise.all([fetchProgress(user.id), fetchSharedRoomsForUsers(user.id, ownerId)])
      .then(([prog, rooms]) => {
        if (cancelled) return;
        setVisitorProgress(prog);
        setSharedRooms(rooms);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2ProfileVisitorPage visitor load failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, ownerId]);

  const buckets = useMemo(() => {
    const out: Record<ShelfStatus, string[]> = { watching: [], want: [], finished: [], stopped: [] };
    for (const sid of Object.keys(ownerProgress)) {
      // TSP demo show is a private onboarding surface — never appears
      // on the public-facing profile (mirrors V2ProfileSelfPage).
      if (sid === "tsp") continue;
      const p = ownerProgress[sid];
      const show = shows.find((s) => s.id === sid);
      out[classifyShow(p, show)].push(sid);
    }
    const byName = (a: string, b: string) => {
      const an = shows.find((s) => s.id === a)?.name ?? a;
      const bn = shows.find((s) => s.id === b)?.name ?? b;
      return an.localeCompare(bn);
    };
    out.watching.sort(byName);
    out.want.sort(byName);
    out.finished.sort(byName);
    out.stopped.sort(byName);
    return out;
  }, [ownerProgress, shows]);

  const finishedPinned = buckets.finished.filter((sid) => ownerProgress[sid]?.canonPin);
  const finishedUnpinned = buckets.finished.filter((sid) => !ownerProgress[sid]?.canonPin);
  const finishedDisplay = [...finishedPinned, ...finishedUnpinned];

  // Per-show context maps for fast lookup during render.
  const sharedRoomByShow = useMemo(() => {
    // If there are multiple shared rooms on the same show, pick the first
    // (alphabetical by group id is stable enough for now). Multi-room CTA
    // shape is a future polish.
    const m = new Map<string, SharedRoomRow>();
    for (const r of sharedRooms) {
      if (!m.has(r.showId)) m.set(r.showId, r);
    }
    return m;
  }, [sharedRooms]);

  const ownerHasPublicOnShow = useMemo(() => {
    const s = new Set<string>();
    for (const t of ownerPublicThreads) s.add(t.showId);
    return s;
  }, [ownerPublicThreads]);

  if (notFound) {
    return (
      <V2Layout palette="profile">
        <div style={{ textAlign: "center", marginTop: 60 }}>
          <h1 style={{ fontFamily: "Lora, Georgia, serif", fontSize: 32, color: "var(--dos-fg)" }}>profile not found</h1>
          <p style={{ marginTop: 16, color: "var(--dos-gray)", fontStyle: "italic", fontFamily: "Lora, Georgia, serif" }}>
            no Sidebar profile for <strong>@{username}</strong>.
          </p>
        </div>
      </V2Layout>
    );
  }

  if (!ownerId) {
    return (
      <V2Layout palette="profile">
        <div style={{ textAlign: "center", marginTop: 60, color: "var(--dos-gray)", fontStyle: "italic" }}>
          loading…
        </div>
      </V2Layout>
    );
  }

  return (
    <V2Layout palette="profile">
      {/* === PROFILE IDENTITY === */}
      <header style={{ textAlign: "center", marginBottom: 32 }}>
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.25)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 36,
            fontWeight: 500,
            marginBottom: 18,
          }}
        >
          {username.charAt(0).toUpperCase()}
        </div>
        <h1
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 600,
            fontSize: 48,
            letterSpacing: "0.02em",
            lineHeight: 1.05,
            color: "var(--dos-fg)",
            textTransform: "uppercase",
            margin: 0,
            marginBottom: 8,
          }}
        >
          {username}
        </h1>
        <div style={{ fontSize: 14, color: "var(--dos-gray)", marginBottom: 12 }}>
          @{username}
        </div>
        {/* Owner's bio if set. Read-only on visitor view; the owner
            edits via V2ProfileSelfPage's BioField. Migration:
            20260510_profile_bio.sql. */}
        {ownerBio && (
          <p
            style={{
              fontFamily: "Lora, Georgia, serif",
              fontStyle: "italic",
              fontSize: 17,
              color: "var(--dos-fg)",
              maxWidth: 540,
              margin: "0 auto 12px",
              lineHeight: 1.5,
            }}
          >
            {ownerBio}
          </p>
        )}
        {!user && (
          <div
            style={{
              maxWidth: 540,
              margin: "0 auto",
              fontFamily: "Lora, Georgia, serif",
              fontStyle: "italic",
              fontSize: 15,
              color: "var(--dos-gray)",
            }}
          >
            sign in to invite @{username} to a friend room about a show you're both watching.
          </div>
        )}
      </header>

      {/* === META PROSE === */}
      <p
        style={{
          textAlign: "center",
          margin: "24px 0 56px",
          fontFamily: "Lora, Georgia, serif",
          fontStyle: "italic",
          fontSize: 16,
          color: "var(--dos-gray)",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
          {Object.keys(ownerProgress).filter((s) => s !== "tsp").length} shows
        </strong>
        {" · "}
        <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
          {buckets.watching.length} watching now
        </strong>
        {" · "}
        <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
          {buckets.want.length} want to watch
        </strong>
      </p>

      {/* === WATCHING NOW === */}
      {buckets.watching.length > 0 && (
        <section style={{ marginBottom: 56 }}>
          <ShelfHead eyebrow={`what @${username} is in the middle of:`} title="Watching Now" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
            {buckets.watching.map((sid) => {
              const show = shows.find((s) => s.id === sid);
              const p = ownerProgress[sid];
              if (!show || !p) return null;
              return (
                <article
                  key={sid}
                  className="card"
                  style={{
                    ...PROFILE_CARD,
                    padding: "22px 26px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                    <div style={{ display: "inline-flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 22, fontWeight: 600, color: "var(--dos-fg)", lineHeight: 1.2 }}>{show.name}</span>
                      <ProgressBadge progress={p} />
                    </div>
                    {p.isRewatching && <span style={{ fontSize: 12, color: "var(--dos-gray)", fontStyle: "italic" }}>rewatch</span>}
                  </div>
                  {p.watchingQuote && (
                    <div
                      style={{
                        paddingLeft: 14,
                        borderLeft: "2px solid var(--danger)",
                        fontFamily: "Lora, Georgia, serif",
                        fontStyle: "italic",
                        fontSize: 15,
                        lineHeight: 1.55,
                        color: "var(--dos-fg)",
                      }}
                    >
                      {p.watchingQuote}
                    </div>
                  )}
                  <ContextualCTAs
                    showId={sid}
                    showName={show.name}
                    visitorLoggedIn={!!user}
                    visitorProgress={visitorProgress[sid]}
                    sharedRoom={sharedRoomByShow.get(sid)}
                    ownerHasPublic={ownerHasPublicOnShow.has(sid)}
                    ownerUsername={username}
                    navigate={navigate}
                  />
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* === WANT TO WATCH === */}
      {buckets.want.length > 0 && (
        <section style={{ marginBottom: 56 }}>
          <ShelfHead eyebrow={`on @${username}'s list, not yet started:`} title="Want to Watch" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {buckets.want.map((sid) => {
              const show = shows.find((s) => s.id === sid);
              const p = ownerProgress[sid];
              if (!show || !p) return null;
              const visitorAlsoWants = !!user && (visitorProgress[sid]?.s === 0 && visitorProgress[sid]?.e === 0);
              return (
                <article
                  key={sid}
                  className="card"
                  style={{
                    ...PROFILE_CARD,
                    padding: "14px 22px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 14 }}>
                    <span style={{ fontSize: 17, fontWeight: 600, color: "var(--dos-fg)" }}>{show.name}</span>
                    {p.wantReason && (
                      <span
                        style={{
                          flex: 1,
                          minWidth: 200,
                          fontFamily: "Lora, Georgia, serif",
                          fontStyle: "italic",
                          fontSize: 15,
                          lineHeight: 1.45,
                          color: "var(--dos-gray)",
                        }}
                      >
                        — {p.wantReason}
                      </span>
                    )}
                  </div>
                  {visitorAlsoWants && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        className="btn h40"
                        onClick={() => navigateToShow(navigate, sid)}
                        style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
                      >
                        you both want this — start a friend room
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* === FINISHED WATCHING === */}
      {finishedDisplay.length > 0 && (
        <section style={{ marginBottom: 56 }}>
          <ShelfHead eyebrow={`shows @${username} has completed:`} title="Finished Watching" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {finishedDisplay.map((sid) => {
              const show = shows.find((s) => s.id === sid);
              const p = ownerProgress[sid];
              if (!show || !p) return null;
              const pinned = !!p.canonPin;
              return (
                <article
                  key={sid}
                  className="card"
                  style={{
                    ...PROFILE_CARD,
                    padding: "20px 22px",
                    position: "relative",
                  }}
                >
                  {pinned && (
                    <span
                      style={{
                        position: "absolute",
                        top: 14,
                        right: 16,
                        fontFamily: "Lora, Georgia, serif",
                        fontStyle: "italic",
                        fontWeight: 500,
                        fontSize: 13,
                        color: "var(--danger)",
                        lineHeight: 1,
                      }}
                    >
                      canon
                    </span>
                  )}
                  <div style={{ fontSize: 18, fontWeight: 600, color: "var(--dos-fg)", lineHeight: 1.2, paddingRight: 64, marginBottom: 10 }}>
                    {show.name}
                  </div>
                  {p.canonTake && (
                    <div
                      style={{
                        fontFamily: "Lora, Georgia, serif",
                        fontStyle: "italic",
                        fontSize: 15,
                        lineHeight: 1.5,
                        color: "var(--dos-gray)",
                      }}
                    >
                      "{p.canonTake}"
                    </div>
                  )}
                  <ContextualCTAs
                    showId={sid}
                    showName={show.name}
                    visitorLoggedIn={!!user}
                    visitorProgress={visitorProgress[sid]}
                    sharedRoom={sharedRoomByShow.get(sid)}
                    ownerHasPublic={ownerHasPublicOnShow.has(sid)}
                    ownerUsername={username}
                    navigate={navigate}
                  />
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* === STOPPED WATCHING ===
          Same double-column grid as Finished Watching for shelf parity
          (mirrors V2ProfileSelfPage). */}
      {buckets.stopped.length > 0 && (
        <section style={{ marginBottom: 56 }}>
          <ShelfHead eyebrow={`shows @${username} has stopped, for now:`} title="Stopped Watching" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {buckets.stopped.map((sid) => {
              const show = shows.find((s) => s.id === sid);
              const p = ownerProgress[sid];
              if (!show || !p) return null;
              return (
                <article
                  key={sid}
                  className="card"
                  style={{
                    ...PROFILE_CARD,
                    padding: "20px 22px",
                  }}
                >
                  <div style={{ display: "inline-flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                    <span style={{ fontSize: 18, fontWeight: 600, color: "var(--dos-fg)", lineHeight: 1.2 }}>{show.name}</span>
                    <span style={{ fontSize: 12, color: "var(--dos-gray)", fontStyle: "italic" }}>stopped at {progressShort(p)}</span>
                  </div>
                  {p.stoppedReason && (
                    <div
                      style={{
                        fontFamily: "Lora, Georgia, serif",
                        fontStyle: "italic",
                        fontSize: 15,
                        lineHeight: 1.5,
                        color: "var(--dos-gray)",
                      }}
                    >
                      — {p.stoppedReason}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </V2Layout>
  );
}

// === Per-card contextual CTAs =================================================
//
// Visible on Watching Now + Finished Watching cards. Want-to-Watch's "you both
// want this" CTA renders inline because it has different copy.
//
// CTA priority (only one collaboration CTA per card, plus the public-posts
// CTA can always render alongside):
//   1. Shared room exists  → "go to your friend room"
//   2. Visitor has any progress on the show, no shared room → "invite to a friend room"
//   3. (Logged-out visitors see neither — only public-posts CTA, if any.)
//
// Public-posts CTA renders independently when the owner has any public threads
// on the show, regardless of room state.
function ContextualCTAs({
  showId,
  showName,
  visitorLoggedIn,
  visitorProgress,
  sharedRoom,
  ownerHasPublic,
  ownerUsername,
  navigate,
}: {
  showId: string;
  showName: string;
  visitorLoggedIn: boolean;
  visitorProgress: ProgressEntry | undefined;
  sharedRoom: SharedRoomRow | undefined;
  ownerHasPublic: boolean;
  ownerUsername: string;
  navigate: NavigateFunction;
}) {
  const collabCTA = (() => {
    if (!visitorLoggedIn) return null;
    if (sharedRoom) {
      return (
        <button
          className="btn h40"
          onClick={() => navigateToShow(navigate, showId, { activeGroupId: sharedRoom.groupId })}
          style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <ArrowRight size={13} /> go to your friend room
        </button>
      );
    }
    if (visitorProgress) {
      return (
        <button
          className="btn h40"
          onClick={() => navigateToShow(navigate, showId)}
          style={{ fontSize: 12 }}
        >
          invite @{ownerUsername} to a friend room
        </button>
      );
    }
    return null;
  })();

  const publicCTA = ownerHasPublic ? (
    <button
      className="btn h40"
      onClick={() => navigate(`/v2/u/${ownerUsername}/show/${showId}/posts`)}
      style={{ fontSize: 12 }}
    >
      see @{ownerUsername}'s public posts on {showName}
    </button>
  ) : null;

  if (!collabCTA && !publicCTA) return null;

  return (
    <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
      {collabCTA}
      {publicCTA}
    </div>
  );
}

function ShelfHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 15, color: "var(--dos-gray)", marginBottom: 4 }}>
        {eyebrow}
      </div>
      <h2 style={{ fontFamily: "Lora, Georgia, serif", fontWeight: 600, fontSize: 28, letterSpacing: "0.04em", color: "var(--dos-fg)", textTransform: "uppercase", margin: 0 }}>
        {title}
      </h2>
    </div>
  );
}

// Plain-text watch-progress indicator. Was a green pill; pills suggest
// interactability and this badge is read-only, so the new spec switches
// to inline text. Mirrors V2ProfileSelfPage's ProgressBadge.
function ProgressBadge({ progress }: { progress: ProgressEntry }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "var(--dos-fg)",
        fontSize: 13,
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      ◐ {progressShort(progress)}
    </span>
  );
}
