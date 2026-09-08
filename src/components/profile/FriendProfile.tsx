// FriendProfile — the friend-visible "Your shows" world (2026-09-08): what a
// viewer sees when they tap someone's name. A VIEW-ONLY re-expression of the
// dashboard's yellow zone — {Name}'s canon (blurbs + essentials) and the
// watching / wants-to-watch / finished shelves — replacing the old pool
// page's content at /pool/:username (the pool RENDERING survives untouched
// for the email-invite arrival, which mounts PublicDashboardPage directly).
//
// Spoiler rules (Alborz 2026-09-08):
//   • A canon card's blurb + essentials are BLOCKED unless the viewer has
//     FINISHED that show (their own progress at its last catalog episode) —
//     the Business-fill stub carries a chat invitation into a shared
//     GROUP's chat when the viewer and owner share any people-group —
//     regardless of whether they share a room for that show (Alborz).
//   • Poster taps never reveal the owner's data: with the show on the
//     viewer's own shelves the tap/hover shows a tilted gap bubble ("You're
//     X episodes ahead of {Name}."); without it, the tap opens the standard
//     "How far in are you?" card in log/want-only form (no guide button) and
//     the viewer STAYS here after adding.
// Data comes from the public get_public_progress RPC (extended 2026-09-08
// with essential_eps / wanted_at / shelf_hidden_at / updated_at) — the page
// works logged-out like the pool always has; pre-SQL it degrades gracefully
// (no want shelf, hides unrespected).

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { CANON } from "../../styles/canon";
import { useAuth } from "../../lib/auth";
import {
  fetchShows, fetchProgress, fetchPublicProgressForUser, upsertRewatchStatus,
  fetchPeopleGroupsForUser, fetchPeopleGroupMembers, fetchContactNames,
  fetchGroupShowVotes, fetchFriendGroupsForUser, setShowVote, ensureProgressRow,
  type Show,
} from "../../lib/db";
import { groupDisplayName } from "../../lib/groupNames";
import type { ProgressEntry } from "../../types";
import { fetchTvmazePoster } from "../../lib/tvmaze";
import { ensureShowReference, stampReferenceLookup, markWantToWatch, type ShowReferenceData } from "../../lib/reference";
import OneSelectProgress from "../OneSelectProgress";
import TrailerCard from "../TrailerCard";
import LoadingDots from "../LoadingDots";
import SidebarLogo from "../SidebarLogo";
import { yellowCard, yellowTitle, startBtn, modalClose } from "../dashboardChrome";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const CREAM = CANON.cream;

// Linear episode distance across seasons (the room-map convention).
function linIdx(s: number, e: number, seasons: number[] | undefined): number {
  if (!seasons?.length || s < 1) return 0;
  let n = 0;
  for (let i = 1; i < s && i <= seasons.length; i++) n += seasons[i - 1] ?? 0;
  return n + e;
}

export default function FriendProfile({
  ownerId, ownerName, mobile = false,
}: {
  ownerId: string;
  /** The viewer's name for the owner (contact name → display name → handle). */
  ownerName: string;
  mobile?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [shows, setShows] = useState<Show[]>([]);
  const [theirProg, setTheirProg] = useState<Record<string, ProgressEntry>>({});
  const [myProg, setMyProg] = useState<Record<string, ProgressEntry>>({});
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  // The people-groups the viewer SHARES with the owner (any — show-agnostic;
  // Alborz correction 2026-09-08) — power the gated-canon chat invitation AND
  // the per-show "want to watch it with {group}" actions (2026-09-08 pt 2).
  // Per group: its display label, the shows anyone there wants (the pool),
  // the viewer's own yeses, and the viewer's rooms under it (showId → roomId).
  const [sharedGroups, setSharedGroups] = useState<{
    id: string; label: string; myVotes: Set<string>; rooms: Record<string, string>;
  }[]>([]);
  // `${groupId}:${showId}` while a group-want is saving.
  const [voteBusy, setVoteBusy] = useState<string | null>(null);
  // Tilted gap bubble: which tile + its line.
  const [bubble, setBubble] = useState<{ showId: string; text: string } | null>(null);
  // The log/want card for shows the viewer doesn't have yet.
  const [cardShow, setCardShow] = useState<Show | null>(null);
  const [picked, setPicked] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [cardBusy, setCardBusy] = useState(false);
  // The owner's essentials share card (only reachable once the viewer has
  // finished the show).
  const [shareShow, setShareShow] = useState<Show | null>(null);
  const [shareRef, setShareRef] = useState<ShowReferenceData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchShows().then((r) => { if (!cancelled) setShows(r); }).catch(() => {});
    fetchPublicProgressForUser(ownerId).then((p) => { if (!cancelled) setTheirProg(p); }).catch(() => {});
    if (user) fetchProgress(user.id).then((p) => { if (!cancelled) setMyProg(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ownerId, user?.id]);

  const showsById = useMemo(() => {
    const m: Record<string, Show> = {};
    for (const s of shows) m[s.id] = s;
    return m;
  }, [shows]);

  const seasonsOf = (show: Show) => (show as unknown as { seasons?: number[] }).seasons;
  const atLatest = (show: Show, p: ProgressEntry | undefined) => {
    const seasons = seasonsOf(show);
    if (!p || !seasons?.length) return false;
    const ls = seasons.length, le = seasons[ls - 1] ?? 1;
    return p.s > ls || (p.s === ls && p.e >= le);
  };
  const started = (p: ProgressEntry | undefined) => !!p && (p.s > 1 || (p.s === 1 && p.e >= 1));

  // The owner's shelves — the dashboard's exact membership rules, view-only.
  const canonList = useMemo(() => shows
    .filter((s) => theirProg[s.id]?.canonPin && !s.isHidden)
    .sort((a, b) => {
      const pa = theirProg[a.id]?.shelfPosition ?? Infinity;
      const pb = theirProg[b.id]?.shelfPosition ?? Infinity;
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    }), [shows, theirProg]);
  const watching = useMemo(() => shows
    .filter((s) => !s.isHidden && started(theirProg[s.id]) && !theirProg[s.id]?.shelfHiddenAt && !atLatest(s, theirProg[s.id]))
    .sort((a, b) => (theirProg[b.id]?.progressUpdatedAt ?? 0) - (theirProg[a.id]?.progressUpdatedAt ?? 0) || a.name.localeCompare(b.name)),
    [shows, theirProg]);
  const wantList = useMemo(() => shows
    .filter((s) => !s.isHidden && theirProg[s.id]?.wantedAt && !started(theirProg[s.id]))
    .sort((a, b) => (theirProg[b.id]?.wantedAt ?? 0) - (theirProg[a.id]?.wantedAt ?? 0)),
    [shows, theirProg]);
  const finishedList = useMemo(() => shows
    .filter((s) => !s.isHidden && started(theirProg[s.id]) && !theirProg[s.id]?.shelfHiddenAt && !theirProg[s.id]?.canonPin && atLatest(s, theirProg[s.id]))
    .sort((a, b) => (theirProg[b.id]?.progressUpdatedAt ?? 0) - (theirProg[a.id]?.progressUpdatedAt ?? 0) || a.name.localeCompare(b.name)),
    [shows, theirProg]);

  // Posters (TVMaze medium, module-cached).
  useEffect(() => {
    let cancelled = false;
    for (const show of [...canonList, ...watching, ...wantList, ...finishedList]) {
      if (!show.tvmazeId || posters[show.id] !== undefined) continue;
      fetchTvmazePoster(show.tvmazeId).then((url) => {
        if (!cancelled) setPosters((prev) => ({ ...prev, [show.id]: url }));
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonList, watching, wantList, finishedList]);

  // Find EVERY people-group the viewer shares with the owner — the chat
  // invitation on gated canon cards points at the first one's chat box, and
  // each carries its own "want to watch it with {label}" action per show.
  useEffect(() => {
    if (!user || user.id === ownerId) { setSharedGroups([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const [groups, contactNames, myRooms] = await Promise.all([
          fetchPeopleGroupsForUser(user.id),
          fetchContactNames(user.id).catch(() => ({} as Record<string, string>)),
          fetchFriendGroupsForUser(user.id).catch(() => []),
        ]);
        const shared: { id: string; label: string; myVotes: Set<string>; rooms: Record<string, string> }[] = [];
        for (const g of groups) {
          const members = await fetchPeopleGroupMembers(g.id);
          if (cancelled) return;
          if (!members.some((m) => m.userId === ownerId)) continue;
          const others = members.filter((m) => m.userId !== user.id);
          const label = groupDisplayName(g, others, contactNames);
          const votes = await fetchGroupShowVotes(g.id).catch(() => []);
          if (cancelled) return;
          const myVotes = new Set(votes.filter((v) => v.userId === user.id).map((v) => v.showId));
          const rooms: Record<string, string> = {};
          for (const r of myRooms) if (r.parentGroupId === g.id && r.showId) rooms[r.showId] = r.id;
          shared.push({ id: g.id, label, myVotes, rooms });
        }
        if (!cancelled) setSharedGroups(shared);
      } catch { if (!cancelled) setSharedGroups([]); }
    })();
    return () => { cancelled = true; };
  }, [user?.id, ownerId]);

  const openChat = () => {
    const gid = sharedGroups[0]?.id;
    if (!gid) return;
    if (mobile) navigate(`/m/group/${gid}/chat`);
    else navigate(`/dashboard?g=${gid}`, { state: { openChat: true } });
  };

  // "want to watch it with {group}" — the same interest signal as the group
  // dashboard's "Do you want to watch too?" yes. Group-only: it does NOT put
  // the show on the viewer's personal shelves (dashboard proposal rules — a
  // not-started row is quietly created off-pool so the room can work later).
  async function wantWithGroup(g: { id: string }, show: Show) {
    if (!user || voteBusy) return;
    setVoteBusy(`${g.id}:${show.id}`);
    try {
      await setShowVote(g.id, show.id, true);
      if (!myProg[show.id]) await ensureProgressRow(user.id, show.id);
      setSharedGroups((prev) => prev.map((x) =>
        x.id === g.id ? { ...x, myVotes: new Set(x.myVotes).add(show.id) } : x));
    } catch (e) { console.error("[friend-profile] group want failed", e); }
    finally { setVoteBusy(null); }
  }
  const openRoom = (roomId: string) => navigate(`${mobile ? "/m" : ""}/show-room/${roomId}`);

  // The tilted gap bubble's line — null when the show isn't on the
  // viewer's own shelves (then the tap opens the log/want card instead).
  function bubbleTextFor(show: Show): string | null {
    const mine = myProg[show.id];
    if (!mine || (!started(mine) && !mine.wantedAt)) return null;
    const theirs = theirProg[show.id];
    const seasons = seasonsOf(show);
    const my = linIdx(mine.s, mine.e, seasons);
    const their = linIdx(theirs?.s ?? 0, theirs?.e ?? 0, seasons);
    if (!started(mine) && their > 0) return `${ownerName} is ${their} episode${their === 1 ? "" : "s"} deep.`;
    if (my > their) { const d = my - their; return `You're ${d} episode${d === 1 ? "" : "s"} ahead of ${ownerName}.`; }
    if (their > my) { const d = their - my; return `${ownerName} is ${d} episode${d === 1 ? "" : "s"} ahead of you.`; }
    return `You're both at S${mine.s} E${mine.e}.`;
  }
  // Desktop: hover shows the bubble, click is inert for shelved shows.
  // Mobile: tap toggles the bubble. Unshelved (signed-in) → the card.
  function onTileTap(show: Show) {
    const text = bubbleTextFor(show);
    if (text) {
      if (mobile) setBubble((prev) => (prev?.showId === show.id ? null : { showId: show.id, text }));
      return;
    }
    if (!user) return;
    setPicked({ s: 0, e: 0 });
    setCardShow(show);
  }
  function onTileHover(show: Show) {
    if (mobile) return;
    const text = bubbleTextFor(show);
    if (text) setBubble({ showId: show.id, text });
  }

  const pickedReady = picked.s >= 1 && picked.e >= 1;
  async function logIt() {
    if (!user || !cardShow || !pickedReady || cardBusy) return;
    setCardBusy(true);
    try {
      const entry: ProgressEntry = { s: picked.s, e: picked.e, highestS: picked.s, highestE: picked.e };
      await upsertRewatchStatus(user.id, cardShow.id, entry);
      stampReferenceLookup(user.id, cardShow.id);
      setMyProg((prev) => ({ ...prev, [cardShow.id]: { ...entry, lastLookedUpAt: Date.now() } }));
      setCardShow(null); // stay on the profile (Alborz)
    } catch (e) { console.error("[friend-profile] log failed", e); }
    finally { setCardBusy(false); }
  }
  async function wantIt() {
    if (!user || !cardShow || cardBusy) return;
    setCardBusy(true);
    try {
      await markWantToWatch(user.id, cardShow.id);
      setMyProg((prev) => ({ ...prev, [cardShow.id]: { ...(prev[cardShow.id] ?? { s: 0, e: 0 }), wantedAt: Date.now() } }));
      setCardShow(null); // stay on the profile
    } catch (e) { console.error("[friend-profile] want failed", e); }
    finally { setCardBusy(false); }
  }

  function openShare(show: Show) {
    setShareShow(show);
    setShareRef(null);
    ensureShowReference(show.id).then((r) => setShareRef(r)).catch(() => {});
  }

  // ── styles ──
  const shelfLabel: React.CSSProperties = { fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, color: CREAM, marginBottom: 10 };
  const tileW = mobile ? 96 : 120, tileH = mobile ? 136 : 170;
  // The bubble is INTERACTIVE since the group-want rows (2026-09-08 pt 2):
  // the wrap's bottom padding bridges the visual gap so a desktop mouse can
  // travel from poster to bubble without a mouseleave killing it.
  const bubbleWrap: React.CSSProperties = {
    position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
    paddingBottom: 6, zIndex: 8,
  };
  const bubbleBox: React.CSSProperties = {
    transform: "rotate(-2deg)", width: "max-content", maxWidth: 210,
    background: CREAM, color: CANON.identity, fontFamily: '"Inter", sans-serif',
    fontWeight: 600, fontSize: 13, lineHeight: 1.35, padding: "10px 12px",
    boxShadow: "0 4px 14px rgba(0,0,0,0.18)", textAlign: "left",
  };

  // One shared group's row for a show — three states: your room exists →
  // open it; you've already said yes → inert ✓; else the want action.
  function groupRow(g: { id: string; label: string; myVotes: Set<string>; rooms: Record<string, string> }, show: Show, surface: "bubble" | "card") {
    const roomId = g.rooms[show.id];
    const busy = voteBusy === `${g.id}:${show.id}`;
    if (surface === "bubble") {
      const link: React.CSSProperties = {
        display: "block", background: "transparent", border: "none", padding: 0, cursor: "pointer",
        color: CANON.identity, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 12,
        textDecoration: "underline", textAlign: "left",
      };
      if (roomId) return <button key={g.id} style={link} onClick={() => openRoom(roomId)}>open your room with {g.label}</button>;
      if (g.myVotes.has(show.id)) return (
        <div key={g.id} style={{ color: CANON.identity, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 12, opacity: 0.75 }}>
          in {g.label}&rsquo;s pool ✓
        </div>
      );
      return (
        <button key={g.id} style={link} disabled={busy} onClick={() => wantWithGroup(g, show)}>
          {busy ? <>one moment<LoadingDots /></> : <>want to watch it with {g.label}</>}
        </button>
      );
    }
    // card — outlined siblings under the primary personal action.
    const outline: React.CSSProperties = {
      ...startBtn, background: "transparent", border: `2px solid ${CREAM}`, color: CREAM,
      width: 210, boxSizing: "border-box", paddingLeft: 0, paddingRight: 0,
    };
    if (roomId) return <button key={g.id} style={outline} onClick={() => openRoom(roomId)}>open your room with {g.label}</button>;
    if (g.myVotes.has(show.id)) return (
      <div key={g.id} style={{ color: CREAM, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 12 }}>
        in {g.label}&rsquo;s pool ✓
      </div>
    );
    return (
      <button key={g.id} style={outline} disabled={busy} onClick={() => wantWithGroup(g, show)}>
        {busy ? <>one moment<LoadingDots /></> : `want to watch it with ${g.label}`}
      </button>
    );
  }

  const renderBubble = (show: Show) => (
    <div style={bubbleWrap}>
      <div style={bubbleBox}>
        {bubble?.text}
        {sharedGroups.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
            {sharedGroups.map((g) => groupRow(g, show, "bubble"))}
          </div>
        )}
      </div>
    </div>
  );

  const tile = (show: Show, caption?: string) => {
    const poster = posters[show.id];
    return (
      <div
        key={show.id}
        style={{ position: "relative", flexShrink: 0, width: tileW }}
        onMouseEnter={() => onTileHover(show)}
        onMouseLeave={() => setBubble((prev) => (prev?.showId === show.id ? null : prev))}
      >
        {bubble?.showId === show.id && renderBubble(show)}
        <button
          onClick={() => onTileTap(show)}
          style={{ width: "100%", background: "transparent", border: "none", padding: 0, cursor: bubbleTextFor(show) && !mobile ? "default" : "pointer", textAlign: "left" }}
        >
          {poster ? (
            <img src={poster} alt={show.name} loading="lazy" style={{ width: tileW, height: tileH, objectFit: "cover", borderRadius: 12, display: "block" }} />
          ) : (
            <div style={{ width: tileW, height: tileH, borderRadius: 12, border: `2px solid ${CREAM}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
              <span style={{ fontFamily: LORA, fontWeight: 700, fontSize: 14, color: CREAM, textAlign: "center" }}>{show.name}</span>
            </div>
          )}
          {caption && (
            <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 12, fontWeight: 700, color: CREAM, marginTop: 6 }}>{caption}</div>
          )}
        </button>
      </div>
    );
  };

  const shelf = (label: string, list: Show[], caption?: (show: Show) => string | undefined) => {
    if (list.length === 0) return null;
    return (
      <div style={{ marginTop: 40, display: "flex", justifyContent: "center" }}>
        <div style={{ maxWidth: "100%", minWidth: 0 }}>
          <div style={shelfLabel}>{label}</div>
          <div style={{ display: "flex", gap: mobile ? 10 : 14, overflowX: "auto", paddingBottom: 6 }}>
            {list.map((s) => tile(s, caption?.(s)))}
          </div>
        </div>
      </div>
    );
  };

  const nothingYet = canonList.length === 0 && watching.length === 0 && wantList.length === 0 && finishedList.length === 0;
  const pw = mobile ? 96 : 96, ph = mobile ? 136 : 136;

  return (
    <div style={{ width: "100%", maxWidth: mobile ? undefined : 1178, margin: "0 auto" }}>
      {/* ── {Name}'s canon — the featured block, view-only ── */}
      <h2 style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 26 : 32, letterSpacing: -1, color: CREAM, margin: 0, textAlign: "center" }}>
        {ownerName}&rsquo;s canon
      </h2>
      {canonList.length === 0 ? (
        <div style={{ fontFamily: '"Inter", sans-serif', fontStyle: "italic", fontSize: 13, color: CREAM, opacity: 0.85, textAlign: "center", marginTop: 14 }}>
          {ownerName} hasn&rsquo;t picked a canon yet.
        </div>
      ) : (
        <div style={{
          marginTop: 32,
          ...(mobile
            ? { display: "flex", flexDirection: "column" as const, gap: 18 }
            : { display: "grid", gridTemplateColumns: "repeat(2, 196px minmax(196px, 240px))", columnGap: 20, rowGap: 36, justifyContent: "center" }),
        }}>
          {canonList.map((show) => {
            const entry = theirProg[show.id];
            const take = entry?.canonTake;
            const essCount = entry?.essentialEps?.length ?? 0;
            const unlocked = atLatest(show, myProg[show.id]); // viewer finished it
            const poster = posters[show.id];
            const posterEl = (w: number, h: number) => (
              <div
                style={{ position: "relative", flexShrink: 0, width: w }}
                onMouseEnter={() => onTileHover(show)}
                onMouseLeave={() => setBubble((prev) => (prev?.showId === show.id ? null : prev))}
              >
                {bubble?.showId === show.id && renderBubble(show)}
                <button
                  onClick={() => onTileTap(show)}
                  style={{ display: "block", background: "transparent", border: "none", padding: 0, cursor: bubbleTextFor(show) && !mobile ? "default" : "pointer" }}
                >
                  {poster ? (
                    <img src={poster} alt={show.name} loading="lazy" style={{ width: w, height: h, objectFit: "cover", borderRadius: 12, display: "block" }} />
                  ) : (
                    <div style={{ width: w, height: h, borderRadius: 12, border: `2px solid ${CREAM}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
                      <span style={{ fontFamily: LORA, fontWeight: 700, fontSize: 16, color: CREAM, textAlign: "center" }}>{show.name}</span>
                    </div>
                  )}
                </button>
              </div>
            );
            const body = (
              <div style={{ minWidth: 0, padding: "2px 8px 0 0", color: CREAM }}>
                <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 16 : 18, lineHeight: 1.2, margin: "2px 0 6px" }}>{show.name}</div>
                {unlocked ? (
                  <>
                    {take && (
                      <div style={{ fontFamily: '"Inter", sans-serif', fontStyle: "italic", fontSize: 13, lineHeight: 1.5, opacity: 0.95 }}>
                        &ldquo;{take}&rdquo;
                      </div>
                    )}
                    {essCount > 0 && (
                      <button
                        onClick={() => openShare(show)}
                        title={`${ownerName}'s essential episodes`}
                        style={{ display: "block", background: "transparent", border: "none", padding: 0, marginTop: 8, cursor: "pointer", color: CREAM, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 12, textDecoration: "underline", textAlign: "left" }}
                      >
                        ★ {essCount} essential episode{essCount === 1 ? "" : "s"}
                      </button>
                    )}
                  </>
                ) : (
                  // The spoiler stub — the map's hidden-writing Business fill.
                  <div style={{ background: CANON.business, borderRadius: 12, padding: "12px 14px", marginTop: 2 }}>
                    <div style={{ fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 13, color: CANON.dark }}>
                      Finish {show.name} to read this.
                    </div>
                    <div style={{ fontFamily: '"Inter", sans-serif', fontStyle: "italic", fontWeight: 400, fontSize: 12, color: CANON.dark, opacity: 0.9, marginTop: 4, lineHeight: 1.45 }}>
                      {ownerName}&rsquo;s take could spoil what&rsquo;s ahead.
                    </div>
                    {sharedGroups.length > 0 && (
                      <button
                        onClick={openChat}
                        style={{ display: "block", background: "transparent", border: "none", padding: 0, marginTop: 8, cursor: "pointer", color: CANON.identity, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 12, textDecoration: "underline", textAlign: "left" }}
                      >
                        chat with {ownerName} about it instead
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
            return mobile ? (
              <div key={show.id} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                {posterEl(pw, ph)}
                {body}
              </div>
            ) : (
              <React.Fragment key={show.id}>
                {posterEl(196, 277)}
                {body}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {shelf(`${ownerName} is watching:`, watching, (s) => {
        const p = theirProg[s.id];
        return p && started(p) ? `S${p.s} E${p.e}` : undefined;
      })}
      {shelf(`${ownerName} wants to watch:`, wantList)}
      {shelf(`${ownerName} has finished:`, finishedList)}

      {nothingYet && (
        <div style={{ fontFamily: '"Inter", sans-serif', fontStyle: "italic", fontSize: 13, color: CREAM, opacity: 0.85, textAlign: "center", marginTop: 40 }}>
          Nothing on the shelves yet.
        </div>
      )}

      {/* ── The owner's essentials share card (viewer has finished the show) ── */}
      {shareShow && (() => {
        const entry = theirProg[shareShow.id];
        const eps = [...(entry?.essentialEps ?? [])].sort((a, b) => a - b);
        return (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(26,58,74,0.25)", overflowY: "auto" }}
            onClick={(e) => { if (e.target === e.currentTarget) setShareShow(null); }}
          >
            <div
              style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", boxSizing: "border-box" }}
              onClick={(e) => { if (e.target === e.currentTarget) setShareShow(null); }}
            >
              <div style={{ background: CREAM, borderRadius: 24, padding: "32px 36px", width: "min(420px, 92vw)", boxSizing: "border-box", boxShadow: "0 12px 36px rgba(0,0,0,0.25)" }}>
                <div style={{ fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, color: CANON.dark }}>{ownerName}&rsquo;s TV Canon</div>
                <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 30, color: CANON.identity, margin: "2px 0 10px" }}>{shareShow.name}</div>
                {entry?.canonTake && (
                  <div style={{ fontFamily: '"Inter", sans-serif', fontStyle: "italic", fontSize: 14, color: CANON.dark, lineHeight: 1.5, marginBottom: 18 }}>
                    &ldquo;{entry.canonTake}&rdquo;
                  </div>
                )}
                <div style={{ borderTop: "1px solid rgba(26,58,74,0.15)", paddingTop: 14 }}>
                  <div style={{ fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, color: CANON.dark, marginBottom: 10 }}>
                    essential episodes according to {ownerName}:
                  </div>
                  {eps.map((k) => {
                    const es = Math.floor(k / 10000), ee = k % 10000;
                    const title = shareRef?.seasons.find((se) => se.n === es)?.episodes.find((ep) => ep.e === ee)?.title;
                    return (
                      <div key={k} style={{ display: "flex", gap: 10, alignItems: "baseline", fontFamily: '"Inter", sans-serif', fontSize: 14, color: CANON.dark, marginBottom: 8 }}>
                        <span style={{ color: CANON.accent, fontSize: 13 }}>★</span>
                        <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>S{es} E{ee}</span>
                        {title ? <span>{title}</span> : (!shareRef ? <LoadingDots /> : null)}
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 16 }}>
                  <SidebarLogo scale={0.4} blocksOpacity={1} surfaceBg={CANON.cream} wordmarkTint={CANON.accent} wordmarkTintOverBlocks={CANON.cream} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── The log/want card for a show the viewer doesn't have — the band's
            grammar minus "open show guide"; the viewer STAYS here after. ── */}
      {cardShow && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(26,58,74,0.25)", zIndex: 1100, overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget && !cardBusy) setCardShow(null); }}
        >
          <div
            style={{ minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "24px 16px", boxSizing: "border-box" }}
            onClick={(e) => { if (e.target === e.currentTarget && !cardBusy) setCardShow(null); }}
          >
            <div style={yellowCard}>
              <button style={modalClose} onClick={() => { if (!cardBusy) setCardShow(null); }} aria-label="Close">
                <X size={16} color={CREAM} />
              </button>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 26, color: CREAM, textAlign: "center", marginBottom: 18 }}>
                {cardShow.name}
              </div>
              <div style={yellowTitle}>How far in are you?</div>
              <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 12, color: CREAM, opacity: 0.85, margin: "6px 0 14px" }}>
                (Set your episode. Nothing you see<br />will ever go past it.)
              </div>
              <style>{`.ref-card-pick select{width:210px;box-sizing:border-box;text-overflow:ellipsis}`}</style>
              <div className="ref-card-pick" style={{ display: "flex", justifyContent: "center" }}>
                <OneSelectProgress
                  show={cardShow}
                  value={picked}
                  allowZero
                  requireConfirm={false}
                  pillBg="transparent"
                  onChangeSelected={(v: { s: number; e: number }) => setPicked(v)}
                  onConfirm={() => {}}
                />
              </div>
              {pickedReady ? (
                <div style={{ marginTop: 18 }}>
                  <button style={{ ...startBtn, width: 210, boxSizing: "border-box", paddingLeft: 0, paddingRight: 0 }} disabled={cardBusy} onClick={logIt}>
                    {cardBusy ? <>one moment<LoadingDots /></> : "just log my progress"}
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 18 }}>
                  <button style={{ ...startBtn, width: 210, boxSizing: "border-box", paddingLeft: 0, paddingRight: 0 }} disabled={cardBusy} onClick={wantIt}>
                    {cardBusy ? <>one moment<LoadingDots /></> : "want to watch"}
                  </button>
                </div>
              )}
              {/* Shared-group actions (2026-09-08 pt 2): one outlined row per
                  group you share with the owner — group interest only, the
                  personal buttons above stay independent. */}
              {sharedGroups.length > 0 && (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                  {sharedGroups.map((g) => groupRow(g, cardShow, "card"))}
                </div>
              )}
            </div>
            <TrailerCard showId={cardShow.id} tvmazeId={cardShow.tvmazeId} />
          </div>
        </div>
      )}
    </div>
  );
}
