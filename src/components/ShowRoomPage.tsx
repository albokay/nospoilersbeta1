/**
 * ShowRoomPage — the restructure (group × show) room (CP4a).
 *
 * Two tabs:
 *   • friend room — the group's feed + season map + dice + nudges, reusing
 *     V2RoomFeed / V2RoomMap (which work against any friend_groups row; the
 *     new rooms ARE parented friend_groups rows).
 *   • private writing — the user's global private journal for this show.
 *
 * Compose is destination-less: "write" publishes ONLY to the current tab —
 * the friend room, or your private journal. No destination picker, no
 * cross-group publishing (the old ComposeForm's picker is retired here).
 *
 * Mounted at /show-room/:roomId, separate from the legacy /room/:groupId
 * (V2FriendRoomPage), which stays untouched for existing friend rooms.
 *
 * Deferred to CP4b (marked inline): rating capture (read-only dice for now),
 * the dashboard private-only standalone, the in-room progress picker, and the
 * notification-signal polish (green/red dots, new-entry outlines).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, SquarePen } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import {
  fetchShows, fetchProgress, fetchRoomMapData, fetchGroupThreads,
  fetchUserThreads, insertThread, addThreadToGroup,
  type Show,
} from "../lib/db";
import { effectiveProgress } from "../lib/utils";
import type { Thread, ProgressEntry } from "../types";
import V2RoomFeed, { type V2RoomFeedEntry, type V2RoomFeedHandle } from "./v2/V2RoomFeed";
import V2RoomMap, { type V2RoomMapMember } from "./v2/V2RoomMap";
import SidebarLogo from "./SidebarLogo";

const C = { green: "#7ABD8E", sky: "#ADC8D7", blue: "#355EB8", yellow: "#DEA838", cream: "#FEF8EA", midnight: "#1A3A4A" };
const LORA = '"Lora", Georgia, serif';
type Tab = "friend" | "private";

export default function ShowRoomPage({ roomId }: { roomId: string }) {
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const feedRef = useRef<V2RoomFeedHandle>(null);

  const [show, setShow] = useState<Show | null>(null);
  const [progressForShow, setProgressForShow] = useState<ProgressEntry | null>(null);
  const [feedEntries, setFeedEntries] = useState<V2RoomFeedEntry[]>([]);
  const [mapMembers, setMapMembers] = useState<V2RoomMapMember[]>([]);
  const [privateEntries, setPrivateEntries] = useState<Thread[]>([]);
  const [tab, setTab] = useState<Tab>("friend");
  const [loading, setLoading] = useState(true);

  // Compose (destination-less)
  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

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
        .select("id, show_id, deleted_at")
        .eq("id", roomId)
        .maybeSingle();
      if (roomErr) throw roomErr;
      if (!roomRow || roomRow.deleted_at) throw new Error("room not found");
      const showId = roomRow.show_id as string;

      const [allShows, progressMap, roomMapData] = await Promise.all([
        fetchShows(), fetchProgress(user.id), fetchRoomMapData(roomId),
      ]);
      const showRow = allShows.find((s) => s.id === showId) ?? null;
      const progress = progressMap[showId] ?? null;
      const eff = effectiveProgress(progress);

      const empty = { threads: [] as Thread[], replyCounts: {} as Record<string, number>, aheadCounts: {} as Record<string, number>, sharedAt: {} as Record<string, number>, latestVisibleReplyAt: {}, hiddenCounts: {}, latestHiddenReplyAt: {} };
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

  async function post() {
    if (!user || !show || posting || !title.trim() || !body.trim()) return;
    const eff = effectiveProgress(progressForShow) ?? { s: progressForShow?.s ?? 0, e: progressForShow?.e ?? 0 };
    const authorName = profile?.username ?? mapMembers.find((m) => m.userId === user.id)?.username ?? "you";
    setPosting(true);
    try {
      const preview = body.slice(0, 240) + (body.length > 240 ? "…" : "");
      const thread = await insertThread({
        showId: show.id, season: eff.s, episode: eff.e,
        authorId: user.id, authorName, title: title.trim(), preview, body: body.trim(), isPublic: false,
      });
      // Destination = the current tab. Friend tab → share into THIS room only.
      if (tab === "friend") await addThreadToGroup(thread.id, roomId);
      setTitle(""); setBody(""); setComposeOpen(false);
      await load();
    } catch (e) {
      console.error("[show-room] post failed", e);
    } finally {
      setPosting(false);
    }
  }

  if (authLoading || loading) {
    return <div style={{ ...page, background: C.green }} aria-busy="true" />;
  }

  const bodyBg = tab === "friend" ? C.sky : C.green;

  return (
    <div style={{ ...page, background: bodyBg }}>
      {/* Header strip */}
      <div style={header}>
        <div style={{ position: "absolute", left: 16, top: 8 }}><SidebarLogo scale={0.45} blocksOpacity={1} /></div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 0 }}>
          <button style={tab === "friend" ? tabActive : tabIdle} onClick={() => setTab("friend")}>friend room</button>
          <button style={tab === "private" ? tabActive : tabIdle} onClick={() => setTab("private")}>private writing</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 30, letterSpacing: -1, color: C.cream, margin: 0 }}>{show?.name ?? "Show"}</h1>
          <button style={closeBtn} title="back to group" onClick={() => navigate("/dashboard")}><X size={20} color={C.cream} /></button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 40px 0" }}>
        <button style={writeBtn} onClick={() => setComposeOpen(true)}>
          <SquarePen size={16} /> write
        </button>
        {progressForShow && (
          <div style={{ background: "transparent", border: "2px solid #fff", borderRadius: 65, padding: "10px 22px", color: "#fff", fontSize: 13, fontWeight: 600 }}>
            you've watched: S{String(progressForShow.s ?? 0).padStart(2, "0")} E{String(progressForShow.e ?? 0).padStart(2, "0")}
          </div>
        )}
      </div>

      {/* Body */}
      {tab === "friend" ? (
        <div style={{ display: "flex", gap: 32, padding: "24px 40px 60px", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {feedEntries.length === 0 ? (
              <div style={{ maxWidth: 420 }}>
                <p style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: C.cream, margin: "16px 0 12px" }}>Be a trailblazer.</p>
                <p style={{ color: C.cream, opacity: 0.85, fontSize: 14, lineHeight: 1.5 }}>
                  You're the first one in here. Start writing so that your friends have your thoughts ready when they finish episodes.
                </p>
                <p style={{ color: C.cream, opacity: 0.85, fontSize: 14, lineHeight: 1.5 }}>
                  Think of it as sending them a letter from the future!
                </p>
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
            )}
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <V2RoomMap
              members={mapMembers}
              seasons={show?.seasons ?? []}
              viewerProgress={progressForShow}
              viewerUserId={user?.id}
              groupId={roomId}
              onEntryClick={(threadId) => feedRef.current?.scrollToEntry(threadId)}
            />
          </div>
        </div>
      ) : (
        <div style={{ padding: "24px 40px 60px", maxWidth: 720 }}>
          {privateEntries.map((t) => (
            <div key={t.id} style={{ border: `2px solid ${C.cream}`, borderRadius: 16, padding: 18, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: C.cream, fontSize: 15 }}>{t.titleBase} <span style={{ opacity: 0.7, fontWeight: 500 }}>· S{t.season} E{t.episode}</span></div>
              <div style={{ color: C.cream, opacity: 0.85, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{t.preview || t.body}</div>
            </div>
          ))}
          <div style={{ marginTop: privateEntries.length ? 40 : 8 }}>
            <p style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: C.cream, margin: "0 0 12px" }}>Sidebar is best with friends.</p>
            <p style={{ color: C.cream, opacity: 0.8, fontSize: 14, lineHeight: 1.5, maxWidth: 460 }}>
              But you can use this private space to write drafts or to keep a personal journal. No one will see what you write here. Sometimes we do our best thinking when we write for ourselves.
            </p>
          </div>
        </div>
      )}

      {/* Compose (destination-less) */}
      {composeOpen && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setComposeOpen(false); }}>
          <div style={composeCard}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 12 }}>
              {tab === "friend" ? "Writing to this friend room" : "Writing to your private journal"}
            </div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="title" style={composeInput} />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="what are you thinking?" rows={8} style={{ ...composeInput, resize: "vertical", marginTop: 10 }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button style={ghostBtn} onClick={() => setComposeOpen(false)}>cancel</button>
              <button style={{ ...postBtn, opacity: posting || !title.trim() || !body.trim() ? 0.5 : 1 }} disabled={posting || !title.trim() || !body.trim()} onClick={post}>
                {posting ? "posting…" : "post"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const page: React.CSSProperties = { position: "fixed", inset: 0, overflowY: "auto", fontFamily: '"Inter", system-ui, sans-serif' };
const header: React.CSSProperties = {
  position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "space-between",
  background: C.green, padding: "14px 40px 0", minHeight: 70,
};
const tabIdle: React.CSSProperties = {
  border: "none", background: "transparent", color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600,
  padding: "10px 18px", cursor: "pointer",
};
const tabActive: React.CSSProperties = {
  border: "none", background: C.sky, color: C.midnight, fontSize: 13, fontWeight: 700,
  padding: "10px 18px", cursor: "pointer", borderTopLeftRadius: 12, borderTopRightRadius: 12,
};
const closeBtn: React.CSSProperties = { border: "none", background: "transparent", cursor: "pointer", padding: 2, lineHeight: 0 };
const writeBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, border: "none", background: C.yellow, color: "#fff",
  fontWeight: 700, fontSize: 14, padding: "12px 24px", borderRadius: 65, cursor: "pointer",
};
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(26,58,74,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 };
const composeCard: React.CSSProperties = { background: C.cream, borderRadius: 20, padding: 28, width: "min(620px, 92vw)" };
const composeInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `2px solid ${C.sky}`, borderRadius: 12,
  padding: "12px 16px", fontFamily: '"Inter", sans-serif', fontSize: 14, color: C.midnight, background: "#fff", outline: "none",
};
const ghostBtn: React.CSSProperties = { border: "none", background: "transparent", color: C.midnight, fontWeight: 700, fontSize: 14, padding: "10px 18px", cursor: "pointer" };
const postBtn: React.CSSProperties = { border: "none", background: C.blue, color: "#fff", fontWeight: 700, fontSize: 14, padding: "10px 32px", borderRadius: 65, cursor: "pointer" };
