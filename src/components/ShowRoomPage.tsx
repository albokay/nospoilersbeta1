/**
 * ShowRoomPage — the restructure (group × show) room (CP4a).
 *
 * Two tabs (friend room / private writing), reusing V2RoomFeed / V2RoomMap for
 * the friend feed + season map + dice + nudges. "write" opens the existing
 * ComposeForm, constrained (restrictGroupId) to THIS friend room + private —
 * no public, no other groups. Mounted at /show-room/:roomId; legacy
 * /room/:groupId (V2FriendRoomPage) is left untouched.
 *
 * Deferred to CP4b (inline): rating capture (read-only dice for now), the
 * dashboard private-only standalone, the in-room progress picker, notification
 * dots, polls/SIKW/highlights stickies.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, SquarePen } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import {
  fetchShows, fetchProgress, fetchRoomMapData, fetchGroupThreads, fetchUserThreads,
  persistProgressUpdate, upsertEpisodeRating, deleteEpisodeRating,
  type Show,
} from "../lib/db";
import { effectiveProgress } from "../lib/utils";
import type { Thread, ProgressEntry } from "../types";
import V2RoomFeed, { type V2RoomFeedEntry, type V2RoomFeedHandle } from "./v2/V2RoomFeed";
import V2RoomMap, { type V2RoomMapMember } from "./v2/V2RoomMap";
import ComposeForm, { type ComposeFormHandle } from "./v2/ComposeForm";
import OneSelectProgress from "./OneSelectProgress";
import RatingCaptureModal from "./RatingCaptureModal";
import SidebarLogo from "./SidebarLogo";

const C = { green: "#7ABD8E", sky: "#ADC8D7", blue: "#355EB8", yellow: "#DEA838", cream: "#FEF8EA", midnight: "#1A3A4A" };
const LORA = '"Lora", Georgia, serif';
const HEADER_H = 92;
type Tab = "friend" | "private";

export default function ShowRoomPage({ roomId }: { roomId: string }) {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const feedRef = useRef<V2RoomFeedHandle>(null);
  const composeFormRef = useRef<ComposeFormHandle>(null);

  const [show, setShow] = useState<Show | null>(null);
  const [parentGroupId, setParentGroupId] = useState<string | null>(null);
  const [progressForShow, setProgressForShow] = useState<ProgressEntry | null>(null);
  const [feedEntries, setFeedEntries] = useState<V2RoomFeedEntry[]>([]);
  const [mapMembers, setMapMembers] = useState<V2RoomMapMember[]>([]);
  const [privateEntries, setPrivateEntries] = useState<Thread[]>([]);
  const [tab, setTab] = useState<Tab>("friend");
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);

  // CP4b: progress picker + rating capture.
  const [pendingRating, setPendingRating] = useState<{ s: number; e: number } | null>(null);
  const ratingTimersRef = useRef<Record<string, number>>({});

  // The reused V2 feed/map expect the group-context palette.
  useEffect(() => {
    document.body.classList.add("group-context");
    return () => { document.body.classList.remove("group-context"); };
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: roomRow, error: roomErr } = await supabase
        .from("friend_groups")
        .select("id, show_id, parent_group_id, deleted_at")
        .eq("id", roomId)
        .maybeSingle();
      if (roomErr) throw roomErr;
      if (!roomRow || roomRow.deleted_at) throw new Error("room not found");
      const showId = roomRow.show_id as string;
      setParentGroupId(roomRow.parent_group_id ?? null);

      const [allShows, progressMap, roomMapData] = await Promise.all([
        fetchShows(), fetchProgress(user.id), fetchRoomMapData(roomId),
      ]);
      const showRow = allShows.find((s) => s.id === showId) ?? null;
      const progress = progressMap[showId] ?? null;
      const eff = effectiveProgress(progress);

      const empty = { threads: [] as Thread[], replyCounts: {} as Record<string, number>, aheadCounts: {} as Record<string, number>, sharedAt: {} as Record<string, number> };
      const gr: any = eff ? await fetchGroupThreads(roomId, eff.s, eff.e, user.id) : empty;

      const departed = new Set(roomMapData.filter((m) => m.isDeparted).map((m) => m.username ?? "").filter(Boolean));
      const u2id: Record<string, string> = {};
      for (const m of roomMapData) if (m.username) u2id[m.username] = m.userId;

      const entries: V2RoomFeedEntry[] = gr.threads.map((t: Thread) => ({
        threadId: t.id, s: t.season, e: t.episode, title: t.titleBase, body: t.body, preview: t.preview,
        authorId: u2id[t.author] ?? "", authorUsername: t.author,
        isRewatch: t.isRewatch, rewatchS: t.rewatchS, rewatchE: t.rewatchE, isEdited: t.isEdited,
        isDeparted: departed.has(t.author), isDeleted: t.isDeleted ?? false,
        updatedAt: gr.sharedAt?.[t.id] || t.updatedAt,
        replyCount: (gr.replyCounts[t.id] ?? 0) + (gr.aheadCounts?.[t.id] ?? 0),
        thread: t,
      }));

      const members: V2RoomMapMember[] = roomMapData.map((m) => ({
        userId: m.userId, username: m.username ?? "?", isDeparted: m.isDeparted,
        progress: m.progress, ratings: m.ratings,
        entries: m.entries.map((e) => ({ threadId: e.threadId, s: e.s, e: e.e, title: e.title })),
      }));

      const mine = await fetchUserThreads(user.id, showId);
      const priv = mine.filter((x) => !x.thread.isPublic && !x.groupId).map((x) => x.thread);

      setShow(showRow);
      setProgressForShow(progress);
      setFeedEntries(entries);
      setMapMembers(members);
      setPrivateEntries(priv);
    } catch (e) {
      console.error("[show-room] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [roomId, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/", { replace: true }); return; }
    load();
  }, [authLoading, user, load, navigate]);

  // × closes the room → back to the group it belongs to (sky group context).
  function closeRoom() {
    navigate(parentGroupId ? `/dashboard?g=${parentGroupId}` : "/dashboard");
  }

  // ── CP4b: progress picker → rating-capture (forward) / confirm (backward) ──
  // Forward pick → rate the episode you finished, then advance + refetch
  // (the feed re-filters to the newly-visible episodes).
  function onForwardPick(val: { s: number; e: number }) { setPendingRating(val); }

  async function commitRating(rating: number) {
    if (!user || !show || !pendingRating) return;
    const target = pendingRating;
    setPendingRating(null);
    upsertEpisodeRating({ userId: user.id, showId: show.id, season: target.s, episode: target.e, rating })
      .catch((e) => console.warn("rating upsert failed", e));
    try {
      await persistProgressUpdate(user.id, show.id, progressForShow ?? undefined, target);
    } catch (e) { console.warn("progress write failed", e); }
    await load();
  }

  async function onProgressConfirm(val: { s: number; e: number }) {
    if (!user || !show) return;
    try { await persistProgressUpdate(user.id, show.id, progressForShow ?? undefined, val); }
    catch (e) { console.warn("progress write failed", e); }
    await load();
  }

  // Click-to-rate a self map cell: optimistic update + debounced write.
  function rateOwnCell(season: number, episode: number, newRating: number | null) {
    if (!user || !show) return;
    setMapMembers((prev) => prev.map((m) => {
      if (m.userId !== user.id) return m;
      if (newRating === null) return { ...m, ratings: m.ratings.filter((r) => !(r.s === season && r.e === episode)) };
      const idx = m.ratings.findIndex((r) => r.s === season && r.e === episode);
      const ratings = idx >= 0 ? m.ratings.map((r, i) => (i === idx ? { ...r, rating: newRating } : r)) : [...m.ratings, { s: season, e: episode, rating: newRating }];
      return { ...m, ratings };
    }));
    const key = `${season}-${episode}`;
    if (ratingTimersRef.current[key]) window.clearTimeout(ratingTimersRef.current[key]);
    ratingTimersRef.current[key] = window.setTimeout(() => {
      const op = newRating === null
        ? deleteEpisodeRating({ userId: user.id, showId: show.id, season, episode })
        : upsertEpisodeRating({ userId: user.id, showId: show.id, season, episode, rating: newRating });
      op.catch((e) => console.warn("rating write failed", e));
      delete ratingTimersRef.current[key];
    }, 500);
  }

  async function commitRatings(changes: { s: number; e: number; rating: number | null }[]): Promise<{ ok: boolean }> {
    if (!user || !show) return { ok: false };
    if (!changes.length) return { ok: true };
    try {
      await Promise.all(changes.map((c) => c.rating === null
        ? deleteEpisodeRating({ userId: user.id, showId: show.id, season: c.s, episode: c.e })
        : upsertEpisodeRating({ userId: user.id, showId: show.id, season: c.s, episode: c.e, rating: c.rating })));
      await load();
      return { ok: true };
    } catch (e) { console.warn("batch rating commit failed", e); return { ok: false }; }
  }

  if (authLoading || loading) {
    return <div style={{ ...page, background: C.green }} aria-busy="true" />;
  }

  const bodyBg = tab === "friend" ? C.sky : C.green;

  return (
    <div style={{ ...page, background: bodyBg }}>
      {/* ── Back-to-group tab — partial pill at the left edge (mirrors chat) ── */}
      <button style={backTab} title="back to group" onClick={closeRoom}>
        <ArrowLeft size={24} color={C.green} />
      </button>

      {/* ── Header strip: logo left · centered name · tabs on the boundary ── */}
      <div style={{ position: "relative", background: C.green, height: HEADER_H }}>
        <div style={{ position: "absolute", left: 20, top: 12 }}><SidebarLogo scale={0.45} blocksOpacity={1} /></div>

        <div style={{ position: "absolute", left: "50%", top: 18, transform: "translateX(-50%)" }}>
          <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: -1, color: C.cream, margin: 0 }}>{show?.name ?? "Show"}</h1>
        </div>

        <div style={{ position: "absolute", left: "26%", bottom: 0, display: "flex", alignItems: "flex-end", gap: 6 }}>
          <RoomTab label="friend room" active={tab === "friend"} bg={C.sky} onClick={() => setTab("friend")} />
          <RoomTab label="private writing" active={tab === "private"} bg={C.green} onClick={() => setTab("private")} />
        </div>
      </div>

      {/* ── Two-pane body — mirrors the live room (V2FriendRoomPage): a 672px
            feed column + season map, the pair centered within a 1400 max width.
            Write + progress live at the top of the column. The private tab
            reuses the same column at the same position; the map area is kept
            (visibility:hidden) so the column doesn't shift between tabs. ── */}
      <div style={{ padding: "24px 24px 0" }}>
        <div style={{ display: "flex", gap: 64, alignItems: "flex-start", justifyContent: "center", maxWidth: 1400, margin: "0 auto" }}>
          {/* LEFT/CENTER pane: toolbar + feed (friend) or private writing */}
          <div style={{ flex: "0 1 672px", minWidth: 0, paddingBottom: 120 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <button style={writeBtn} onClick={() => setComposeOpen(true)}><SquarePen size={16} /> write</button>
              {show && progressForShow && (
                <OneSelectProgress
                  show={show}
                  value={effectiveProgress(progressForShow) || { s: 1, e: 1 }}
                  onConfirm={onProgressConfirm}
                  onForwardPick={onForwardPick}
                  requireConfirm
                  allowZero={(effectiveProgress(progressForShow)?.s ?? 1) === 0}
                />
              )}
            </div>

            {tab === "friend" ? (
              feedEntries.length === 0 ? (
                <div style={{ maxWidth: 420 }}>
                  <p style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: C.cream, margin: "16px 0 12px" }}>Be a trailblazer.</p>
                  <p style={emptyCopy}>You're the first one in here. Start writing so that your friends have your thoughts ready when they finish episodes.</p>
                  <p style={emptyCopy}>Think of it as sending them a letter from the future!</p>
                </div>
              ) : (
                <V2RoomFeed
                  ref={feedRef}
                  entries={feedEntries}
                  groupId={roomId}
                  viewerProgress={progressForShow}
                  userId={user?.id ?? ""}
                  onReplyAdded={(tid) => setFeedEntries((prev) => prev.map((e) => (e.threadId === tid ? { ...e, replyCount: e.replyCount + 1 } : e)))}
                />
              )
            ) : (
              <>
                {privateEntries.map((t) => (
                  <div key={t.id} style={{ border: `2px solid ${C.cream}`, borderRadius: 16, padding: 18, marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, color: C.cream, fontSize: 15 }}>{t.titleBase} <span style={{ opacity: 0.7, fontWeight: 500 }}>· S{t.season} E{t.episode}</span></div>
                    <div style={{ color: C.cream, opacity: 0.85, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{t.preview || t.body}</div>
                  </div>
                ))}
                <div style={{ marginTop: privateEntries.length ? 40 : 8 }}>
                  <p style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: C.cream, margin: "0 0 12px" }}>Sidebar is best with friends.</p>
                  <p style={{ ...emptyCopy, maxWidth: 460 }}>But you can use this private space to write drafts or to keep a personal journal. No one will see what you write here. Sometimes we do our best thinking when we write for ourselves.</p>
                </div>
              </>
            )}
          </div>

          {/* RIGHT pane: season map. Reserved but hidden on the private tab so
              the left column keeps the exact same placement across tabs. */}
          <div style={{ flex: "0 0 auto", visibility: tab === "friend" ? "visible" : "hidden" }} aria-hidden={tab !== "friend"}>
            <V2RoomMap
              members={mapMembers}
              seasons={show?.seasons ?? []}
              viewerProgress={progressForShow}
              viewerUserId={user?.id}
              groupId={roomId}
              onEntryClick={(threadId) => feedRef.current?.scrollToEntry(threadId)}
              onRateOwnCell={rateOwnCell}
              onCommitRatings={commitRatings}
            />
          </div>
        </div>
      </div>

      {/* ── Compose: the existing ComposeForm, constrained to this room + private ── */}
      {composeOpen && createPortal(
        <div style={composeBackdrop}>
          <div style={composeCardOuter}>
            <button onClick={() => composeFormRef.current?.attemptDiscard()} aria-label="Discard and close" style={composeCloseX}>×</button>
            <ComposeForm
              ref={composeFormRef}
              showId={show?.id}
              restrictGroupId={roomId}
              hideTopRightClose
              onCancel={() => setComposeOpen(false)}
              onSubmitted={(destination) => {
                setComposeOpen(false);
                setTab(destination === "private" ? "private" : "friend");
                load();
              }}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* CP4b: rate the episode you just finished (forward progress pick) */}
      {pendingRating && (
        <RatingCaptureModal
          season={pendingRating.s}
          episode={pendingRating.e}
          onCommit={commitRating}
          onCancel={() => setPendingRating(null)}
        />
      )}
    </div>
  );
}

function RoomTab({ label, active, bg, onClick }: { label: string; active: boolean; bg: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        cursor: "pointer", padding: "6px 22px",
        borderTopLeftRadius: 14, borderTopRightRadius: 14,
        // Cream outline lives only on the deselected tab; the selected tab is
        // a clean fill that bleeds into the panel below.
        borderTop: active ? "none" : `2px solid ${C.cream}`,
        borderLeft: active ? "none" : `2px solid ${C.cream}`,
        borderRight: active ? "none" : `2px solid ${C.cream}`,
        borderBottom: "none",
        fontFamily: LORA, fontWeight: 700, fontSize: 18, letterSpacing: -0.3,
        background: active ? bg : "transparent",
        color: active ? C.midnight : "rgba(255,255,255,0.75)",
        position: "relative", bottom: -2, // bleed into the panel below
      }}
    >
      {label}
    </button>
  );
}

const page: React.CSSProperties = { position: "fixed", inset: 0, overflowY: "auto", fontFamily: '"Inter", system-ui, sans-serif' };
const backTab: React.CSSProperties = {
  position: "fixed", left: 0, top: "18%", background: C.cream, border: "none", cursor: "pointer",
  borderTopRightRadius: 28, borderBottomRightRadius: 28, padding: "16px 22px 16px 14px",
  display: "inline-flex", alignItems: "center", boxShadow: "6px 6px 18px rgba(0,0,0,0.15)", zIndex: 45,
};
const writeBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, border: "none", background: C.yellow, color: "#fff",
  fontWeight: 700, fontSize: 14, padding: "12px 24px", borderRadius: 65, cursor: "pointer",
};
const emptyCopy: React.CSSProperties = { color: C.cream, opacity: 0.85, fontSize: 14, lineHeight: 1.5 };
const composeBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const composeCardOuter: React.CSSProperties = {
  position: "relative", width: "85vw", height: "90vh", background: C.cream,
  borderRadius: 24, boxShadow: "0 12px 36px rgba(0,0,0,0.25)", overflow: "auto",
};
const composeCloseX: React.CSSProperties = {
  position: "absolute", top: 20, right: 24, background: "transparent", border: "2px solid rgba(43,36,24,0.32)",
  color: "#5a4d3a", borderRadius: "50%", width: 34, height: 34, padding: 0,
  display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16, cursor: "pointer", zIndex: 10,
};
