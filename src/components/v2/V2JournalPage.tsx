import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  fetchShows,
  fetchProgress,
  fetchUserThreads,
  fetchUserReplies,
  fetchRepliesToUserThreads,
  fetchLikedThreads,
  fetchLikedReplies,
  fetchFriendGroupsForUser,
} from "../../lib/db";
import type { Show } from "../../lib/db";
import type { Thread, Reply, ProgressEntry, FriendGroup } from "../../types";
import SearchShows from "../SearchShows";
import EpisodeTag from "../EpisodeTag";
import { timeAgo } from "../../lib/utils";
import { linkifyText } from "../../lib/linkify";
import V2Layout from "./V2Layout";
import { ChevronDown, SquarePen, Users, Globe } from "lucide-react";

type ThreadRow = { thread: Thread; groupId?: string; groupName?: string };
type ReplyRow = { reply: Reply; thread: Thread; groupId?: string; groupName?: string };

// Derived destination chips for an entry. Today the schema permits any
// combination but the live composer never wrote both is_public AND a
// group_threads row on the same thread (verified in prod: 0 rows). The
// new model relaxes that — render whatever combination is set.
function chipsFor(row: ThreadRow): Array<"public" | "friend"> {
  const out: Array<"public" | "friend"> = [];
  if (row.thread.isPublic) out.push("public");
  if (row.groupId) out.push("friend");
  return out;
}

function formatProgressShort(p?: ProgressEntry): string {
  if (!p) return "—";
  if (p.s === 0 && p.e === 0) return "haven't started";
  return `S${String(p.s).padStart(2, "0")} E${String(p.e).padStart(2, "0")}`;
}

function formatSinceDate(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("en-US", { month: "long", day: "numeric" });
}

export default function V2JournalPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, loading: authLoading } = useAuth();

  // URL → activeShowId. /v2/journal           → first show
  //                     /v2/journal/:showId   → that show
  const parts = location.pathname.split("/").filter(Boolean);
  const urlShowId = parts[0] === "v2" && parts[1] === "journal" ? parts[2] : undefined;

  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [allUserThreads, setAllUserThreads] = useState<ThreadRow[]>([]);
  const [groupsForActive, setGroupsForActive] = useState<FriendGroup[]>([]);
  const [tabReplies, setTabReplies] = useState<{
    myReplies: ReplyRow[];
    repliesToMe: ReplyRow[];
    likedThreads: Thread[];
    likedReplies: ReplyRow[];
  }>({ myReplies: [], repliesToMe: [], likedThreads: [], likedReplies: [] });
  const [chevronOpen, setChevronOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 1080);

  useEffect(() => {
    const fn = () => setIsNarrow(window.innerWidth < 1080);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  // Bootstrap data: shows, progress, all user threads. One pass on user change.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([fetchShows(), fetchProgress(user.id), fetchUserThreads(user.id)])
      .then(([allShows, prog, threads]) => {
        if (cancelled) return;
        setShows(allShows);
        setProgress(prog);
        setAllUserThreads(threads);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2JournalPage bootstrap failed (recoverable):", err);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Active show selection — URL wins; fallback to first show in user's progress.
  const userShowIds = useMemo(() => {
    return Object.keys(progress).filter((sid) => {
      // Hide shows the user has no real progress for (defensive). The
      // stopped-watching gate lands in checkpoint 8 — for now every
      // progress row is surfaced.
      return progress[sid] !== undefined;
    });
  }, [progress]);

  const activeShowId =
    urlShowId && userShowIds.includes(urlShowId)
      ? urlShowId
      : userShowIds[0] ?? null;

  const activeShow = useMemo(
    () => (activeShowId ? shows.find((s) => s.id === activeShowId) : undefined),
    [activeShowId, shows]
  );

  // Per-show responses-section data. Refetches when active show changes.
  useEffect(() => {
    if (!user || !activeShowId) {
      setTabReplies({ myReplies: [], repliesToMe: [], likedThreads: [], likedReplies: [] });
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchUserReplies(user.id, activeShowId),
      fetchRepliesToUserThreads(user.id, activeShowId),
      fetchLikedThreads(user.id, activeShowId),
      fetchLikedReplies(user.id, activeShowId),
      fetchFriendGroupsForUser(user.id, activeShowId),
    ])
      .then(([myR, repliesToMe, likedT, likedR, groups]) => {
        if (cancelled) return;
        setTabReplies({
          myReplies: myR,
          repliesToMe,
          likedThreads: likedT,
          likedReplies: likedR,
        });
        setGroupsForActive(groups);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2JournalPage per-show fetch failed (recoverable):", err);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, activeShowId]);

  // Per-show entry feed = filter all-user-threads to the active show.
  const activeEntries = useMemo(
    () => allUserThreads.filter((r) => r.thread.showId === activeShowId),
    [allUserThreads, activeShowId]
  );

  // Per-show entry counts for rail meta.
  const countByShow = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of allUserThreads) {
      m[r.thread.showId] = (m[r.thread.showId] ?? 0) + 1;
    }
    return m;
  }, [allUserThreads]);

  // Auth gate. Mirrors /profile gate — signed-out users go home.
  if (!authLoading && !user) {
    return <V2Layout palette="journal"><div /></V2Layout>;
  }

  const sinceTs = activeEntries.length
    ? activeEntries[activeEntries.length - 1].thread.createdAt
    : undefined;

  return (
    <V2Layout
      palette="journal"
      pairedHeader={
        profile
          ? {
              left: "this is your journal",
              rightLabel: "go to your public profile",
              rightTo: "/v2/profile",
            }
          : undefined
      }
    >
      <div style={{ display: "flex", gap: 36, alignItems: "flex-start", flexWrap: isNarrow ? "wrap" : "nowrap" }}>
        {/* === LEFT RAIL === */}
        <aside
          style={
            isNarrow
              ? { width: "100%" }
              : { width: 250, flexShrink: 0, position: "sticky", top: 100, alignSelf: "flex-start" }
          }
        >
          <SearchShows
            shows={shows}
            progress={progress}
            onReopenJournal={(showId) => navigate(`/v2/journal/${showId}`)}
            onShowCreated={(s) => navigate(`/v2/journal/${s.id}`)}
            onAuthRequired={() => navigate("/")}
            placeholder="find a show"
          />

          <div
            style={{
              fontFamily: "Lora, Georgia, serif",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--dos-gray)",
              margin: "16px 0 8px",
              paddingLeft: 6,
            }}
          >
            your shows
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {userShowIds.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--dos-gray)", fontStyle: "italic", padding: "8px 6px" }}>
                no shows yet — search above to add one.
              </div>
            )}
            {userShowIds.map((sid) => {
              const s = shows.find((sh) => sh.id === sid);
              if (!s) return null;
              const active = sid === activeShowId;
              const p = progress[sid];
              const count = countByShow[sid] ?? 0;
              return (
                <button
                  key={sid}
                  onClick={() => navigate(`/v2/journal/${sid}`)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                    textAlign: "left",
                    background: active ? "rgba(255,255,255,0.18)" : "transparent",
                    border: "2px solid transparent",
                    color: "var(--dos-fg)",
                    padding: "8px 14px",
                    fontSize: 14,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    borderRadius: 9999,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 11, color: "var(--dos-gray)", fontWeight: 500, lineHeight: 1.2, flexShrink: 0, marginLeft: 8 }}>
                    {count > 0 && <span>{count}</span>}
                    <span style={{ fontSize: 10 }}>{formatProgressShort(p)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* === MAIN COLUMN === */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Journal panel — uses live-site visual conventions:
              2px white border, no drop shadow, square corners, --dos-bg ground.
              Fixed height with internal scroll = same shape as the live
              .diaryCardWrap > .card (action bar fixed at top, entries scroll
              inside). Mirrors theme.ts .diaryScrollArea. */}
          <section
            style={{
              position: "relative",
              border: "2px solid #fff",
              background: "var(--dos-bg)",
              height: 720,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* layered "diary" depth — same trick as live ProfilePage */}
            {([24, 16, 8] as const).map((offset) => {
              const opacity = offset === 24 ? 0.18 : offset === 16 ? 0.36 : 0.55;
              return (
                <div
                  key={offset}
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    border: "2px solid",
                    borderColor: `rgba(255,255,255,${opacity})`,
                    background: "var(--dos-bg)",
                    transform: `translate(-${offset}px, ${offset}px)`,
                    zIndex: -1,
                  }}
                />
              );
            })}

            {!activeShow ? (
              <div style={{ fontStyle: "italic", color: "var(--dos-gray)", padding: "32px 32px" }}>
                no shows in your journal yet. search above to add one.
              </div>
            ) : (
              <>
                {/* fixed-position header: heading + meta + action row.
                    Sits above the scroll container so entries never bleed
                    above it (same pattern as live .profileActionBar). */}
                <div style={{ flexShrink: 0, padding: "28px 32px 18px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
                  <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <h1
                      style={{
                        fontFamily: "Lora, Georgia, serif",
                        fontWeight: 600,
                        fontSize: 34,
                        letterSpacing: "0.02em",
                        textTransform: "uppercase",
                        color: "#fff",
                        lineHeight: 1.05,
                        margin: 0,
                      }}
                    >
                      {activeShow.name}
                    </h1>
                    <button
                      onClick={(e) => { e.stopPropagation(); setChevronOpen((v) => !v); }}
                      title="show options"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--dos-gray)",
                        cursor: "pointer",
                        padding: "4px 6px",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <ChevronDown size={20} />
                    </button>

                    {chevronOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          marginTop: 6,
                          background: "var(--dos-bg)",
                          border: "2px solid #fff",
                          padding: 8,
                          minWidth: 320,
                          maxWidth: 360,
                          zIndex: 5,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          disabled
                          title="lands in a later checkpoint"
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            background: "transparent",
                            border: "none",
                            padding: "10px 12px",
                            color: "var(--dos-fg)",
                            fontSize: 14,
                            cursor: "not-allowed",
                            opacity: 0.7,
                          }}
                        >
                          close show / stop watching
                          <span
                            style={{
                              display: "block",
                              fontFamily: "Lora, Georgia, serif",
                              fontStyle: "italic",
                              fontSize: 12,
                              color: "var(--dos-gray)",
                              lineHeight: 1.5,
                              marginTop: 4,
                            }}
                          >
                            Closes the show in your journal and removes you from any friend rooms on this show. Searching for the show again restores your entries and progress, but not room memberships.
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* progress pill — visual only, mirrors live --dos-user pill */}
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      background: "var(--dos-user)",
                      color: "#fff",
                      borderRadius: 9999,
                      padding: "6px 16px",
                      fontSize: 13,
                      fontWeight: 600,
                      height: 30,
                    }}
                  >
                    you've watched: {formatProgressShort(progress[activeShow.id])}
                  </span>
                </div>

                <div
                  style={{
                    fontFamily: "Lora, Georgia, serif",
                    fontStyle: "italic",
                    fontSize: 14,
                    color: "var(--dos-gray)",
                    marginBottom: 18,
                  }}
                >
                  {activeEntries.length} {activeEntries.length === 1 ? "entry" : "entries"}
                  {sinceTs ? ` written since ${formatSinceDate(sinceTs)}` : ""}
                </div>

                {/* action row */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
                  <button
                    className="btn post h40"
                    onClick={() => navigate(`/v2/compose/${activeShow.id}`)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <SquarePen size={14} /> write a new entry
                  </button>
                  {groupsForActive.length > 0 && (
                    <button
                      className="btn h40"
                      onClick={() => {
                        const g = groupsForActive[0];
                        navigate(`/show/${activeShow.id}${groupsForActive.length === 1 ? `?group=${g.id}` : ""}`);
                      }}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      <Users size={14} /> {groupsForActive.length === 1 ? "→ your friend room" : `→ your ${groupsForActive.length} friend rooms`}
                    </button>
                  )}
                  <button
                    className="btn h40"
                    onClick={() => navigate(`/show/${activeShow.id}`)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <Globe size={14} /> → public conversation
                  </button>
                </div>
                </div>{/* /fixed-position header */}

                {/* entry feed — scrolls inside the panel.
                    Borders + padding match live .diaryScrollArea. */}
                <div style={{ flex: 1, overflowY: "auto", padding: "0 32px 24px", borderTop: "1px solid rgba(255,255,255,0.25)" }}>
                  {activeEntries.length === 0 && (
                    <div style={{ padding: "24px 0", color: "var(--dos-gray)", fontStyle: "italic" }}>
                      no entries on this show yet.
                    </div>
                  )}
                  {activeEntries.map((row, idx) => {
                    const t = row.thread;
                    const chips = chipsFor(row);
                    return (
                      <article
                        key={t.id}
                        style={{
                          padding: "20px 0",
                          borderTop: idx === 0 ? "none" : "1px solid rgba(255,255,255,0.18)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                            <h3
                              className="title"
                              style={{
                                fontSize: 20,
                                fontWeight: 600,
                                color: "#fff",
                                lineHeight: 1.25,
                                margin: 0,
                              }}
                            >
                              {t.titleBase}
                            </h3>
                            <span style={{ fontSize: 13, color: "var(--dos-gray)", fontWeight: 500 }}>
                              <EpisodeTag season={t.season} episode={t.episode} isRewatch={t.isRewatch} rewatchS={t.rewatchS} rewatchE={t.rewatchE} parens={false} />
                            </span>
                          </div>
                          <span style={{ fontSize: 13, color: "var(--dos-gray)" }}>{timeAgo(t.updatedAt)}</span>
                        </div>

                        {chips.length > 0 && (
                          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                            {chips.includes("friend") && (
                              <a
                                href={`/show/${t.showId}${row.groupId ? `?group=${row.groupId}` : ""}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  navigate(`/show/${t.showId}${row.groupId ? `?group=${row.groupId}` : ""}`);
                                }}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "4px 12px",
                                  borderRadius: 9999,
                                  background: "rgba(53,94,184,0.22)",
                                  color: "#fff",
                                  border: "2px solid #355eb8",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  letterSpacing: "0.02em",
                                  textDecoration: "none",
                                  cursor: "pointer",
                                }}
                              >
                                friend room{row.groupName ? ` · ${row.groupName}` : ""}
                              </a>
                            )}
                            {chips.includes("public") && (
                              <a
                                href={`/show/${t.showId}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  navigate(`/show/${t.showId}`);
                                }}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "4px 12px",
                                  borderRadius: 9999,
                                  background: "rgba(222,168,56,0.25)",
                                  color: "#fff",
                                  border: "2px solid #dea838",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  letterSpacing: "0.02em",
                                  textDecoration: "none",
                                  cursor: "pointer",
                                }}
                              >
                                public
                              </a>
                            )}
                          </div>
                        )}

                        <div className="clamp3" style={{ fontSize: 15, lineHeight: 1.6, color: "var(--dos-fg)" }}>
                          {linkifyText(t.preview || t.body)}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          {/* === RESPONSES SECTIONS — lifted from ProfilePage, scoped to active show.
              Existing classes (.title/.card/.reply-card/.threadCard/.muted/.clamp3)
              already match the live look on default body palette. === */}
          {activeShowId && (
            <>
              <section style={{ marginTop: 56 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>responses to you</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabReplies.repliesToMe.length === 0 && <div className="muted">No responses yet.</div>}
                  {tabReplies.repliesToMe.map(({ reply: r, thread: t, groupName }) => (
                    <div
                      key={r.id}
                      className="card reply-card"
                      style={{
                        margin: "10px 0",
                        cursor: "pointer",
                        color: "var(--dos-bg)",
                        ["--dos-accent" as any]: "var(--dos-bg)",
                        ["--dos-cyan" as any]: "var(--dos-bg)",
                        ["--dos-gray" as any]: "rgba(222,168,56,0.65)",
                      }}
                      onClick={() => navigate(`/show/${t.showId}`)}
                    >
                      <div className="muted" style={{ fontSize: 14 }}>On <b>{t.titleBase}</b></div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                        {" • "}
                        {groupName ? <span style={{ fontStyle: "italic" }}>in {groupName}</span> : <span style={{ fontStyle: "italic" }}>publicly</span>}
                        {" • "}
                        <span className="username">@{r.author}</span>
                      </div>
                      <div className="clamp3" style={{ marginTop: 6, fontSize: 15 }}>{linkifyText(r.body)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ marginTop: 24 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your responses</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabReplies.myReplies.length === 0 && <div className="muted">No responses yet.</div>}
                  {tabReplies.myReplies.map(({ reply: r, thread: t }) => (
                    <div
                      key={r.id}
                      className="card reply-card"
                      style={{
                        margin: "10px 0",
                        cursor: "pointer",
                        color: "var(--dos-bg)",
                        ["--dos-accent" as any]: "var(--dos-bg)",
                        ["--dos-cyan" as any]: "var(--dos-bg)",
                        ["--dos-gray" as any]: "rgba(222,168,56,0.65)",
                      }}
                      onClick={() => navigate(`/show/${t.showId}`)}
                    >
                      <div className="muted" style={{ fontSize: 14 }}>On <b>{t.titleBase}</b></div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                      </div>
                      <div className="clamp3" style={{ marginTop: 6, fontSize: 15 }}>{linkifyText(r.body)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ marginTop: 24 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your starred entries</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabReplies.likedThreads.length === 0 && <div className="muted">No starred entries yet.</div>}
                  {tabReplies.likedThreads.map((t) => (
                    <div
                      key={t.id}
                      className="card threadCard"
                      style={{ margin: "10px 0", cursor: "pointer", position: "relative" }}
                      onClick={() => navigate(`/show/${t.showId}`)}
                    >
                      <div className="title" style={{ fontSize: 18 }}>{t.titleBase}</div>
                      <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.7, marginTop: 2 }}>
                        <EpisodeTag season={t.season} episode={t.episode} isRewatch={t.isRewatch} rewatchS={t.rewatchS} rewatchE={t.rewatchE} />
                      </div>
                      <div className="clamp3" style={{ marginTop: 6 }}>{t.preview || t.body}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ marginTop: 24 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your starred responses</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabReplies.likedReplies.length === 0 && <div className="muted">No starred responses yet.</div>}
                  {tabReplies.likedReplies.map(({ reply: r, thread: t }) => (
                    <div
                      key={r.id}
                      className="card reply-card"
                      style={{
                        margin: "10px 0",
                        cursor: "pointer",
                        color: "var(--dos-bg)",
                        ["--dos-accent" as any]: "var(--dos-bg)",
                        ["--dos-cyan" as any]: "var(--dos-bg)",
                        ["--dos-gray" as any]: "rgba(222,168,56,0.65)",
                      }}
                      onClick={() => navigate(`/show/${t.showId}`)}
                    >
                      <div className="muted" style={{ fontSize: 14 }}>On <b>{t.titleBase}</b></div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                        {" • "}
                        <span className="username">@{r.author}</span>
                      </div>
                      <div className="clamp3" style={{ marginTop: 6, fontSize: 15 }}>{linkifyText(r.body)}</div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {/* close chevron-dropdown when clicking elsewhere */}
      {chevronOpen && (
        <div
          onClick={() => setChevronOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 4 }}
          aria-hidden
        />
      )}
    </V2Layout>
  );
}
