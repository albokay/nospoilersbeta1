import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchGroupDashboard, fetchShows, fetchPeopleGroupMembers, fetchContactNames, fetchPublicProgressForUser,
  setShowVote, ensureProgressRow, startShowRoom, createShow,
  type Show, type GroupDashboardShow, type BrowseShow,
} from "../lib/db";
import { tvmazeEpisodes, slugify, fetchTvmazePoster } from "../lib/tvmaze";
import { getTrailerKeyCached } from "../lib/trailers";
import { personDisplayName, joinNames } from "../lib/groupNames";
import { CANON } from "../styles/canon";
import YesNoToggle from "./YesNoToggle";
import InviteShowCard from "./InviteShowCard";
import BrowseRows from "./BrowseRows";
import MobileBrowseRows from "../mobile/MobileBrowseRows";

/**
 * WhatsNextPanel (letters from Sidebar, Alborz 2026-09-28): the opt-in moment
 * under the "what's next" letter. Three parts, in his order: the group's
 * proposals (poster, "Name · trailer", who's in, the yes/no toggle, "start
 * the room" once you're in), then the members' own lists (quieter, a
 * "propose" button), then the browse strip whose posters open the trailer
 * card with a yes/no toggle — yes proposes the show here, creating its
 * catalog row when Sidebar doesn't have it yet (the invite landing's path).
 * Both idioms; the ticket's dark-on-sky palette.
 */
type Member = { userId: string; username: string; displayName?: string | null };
type Card = { id: string; name: string; tvmazeId: number; catalogId: string | null };

const INTER = '"Inter", sans-serif';

export default function WhatsNextPanel({ groupId, userId, mobile = false, onOpenRoom }: {
  groupId: string;
  userId: string;
  mobile?: boolean;
  onOpenRoom?: (roomId: string, showId: string) => void;
}) {
  const [dash, setDash] = useState<GroupDashboardShow[] | null>(null);
  const [shows, setShows] = useState<Show[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [contactNames, setContactNames] = useState<Record<string, string>>({});
  const [lists, setLists] = useState<Record<string, string[]>>({});
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [trailerOk, setTrailerOk] = useState<Record<string, boolean>>({});
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const asked = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [d, s, m, cn] = await Promise.all([
          fetchGroupDashboard(groupId), fetchShows(), fetchPeopleGroupMembers(groupId),
          fetchContactNames(userId).catch(() => ({} as Record<string, string>)),
        ]);
        if (cancelled) return;
        setDash(d); setShows(s); setMembers(m); setContactNames(cn);
        // The members' own lists: S0 E0 rows they put there themselves
        // (in_pool), not stopped, not hidden, and not already in this group.
        const inGroup = new Set(d.map((g) => g.showId));
        const owners: Record<string, string[]> = {};
        await Promise.all(m.map(async (mem) => {
          try {
            const prog = await fetchPublicProgressForUser(mem.userId);
            for (const [showId, p] of Object.entries(prog)) {
              if (p.inPool !== true || (p.s ?? 0) > 0 || (p.e ?? 0) > 0 || p.stoppedWatching || p.shelfHiddenAt || inGroup.has(showId)) continue;
              (owners[showId] ??= []).push(mem.userId);
            }
          } catch { /* one member's list missing is fine */ }
        }));
        if (!cancelled) setLists(owners);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, userId]);

  const showById = useMemo(() => {
    const m: Record<string, Show> = {};
    for (const s of shows) m[s.id] = s;
    return m;
  }, [shows]);
  const nameOf = (uid: string) => {
    const mem = members.find((x) => x.userId === uid);
    return mem ? personDisplayName(contactNames, uid, mem.username, mem.displayName) : "a friend";
  };

  const proposals = useMemo(() => (dash ?? [])
    .filter((g) => !g.roomId && showById[g.showId])
    .map((g) => ({ g, show: showById[g.showId], voters: g.members.filter((m) => m.voted).map((m) => m.userId) }))
    .sort((a, b) => (b.voters.length - a.voters.length) || a.show.name.localeCompare(b.show.name)), [dash, showById]);
  const listRows = useMemo(() => Object.entries(lists)
    .filter(([showId]) => showById[showId])
    .map(([showId, owners]) => ({ show: showById[showId], owners }))
    .sort((a, b) => a.show.name.localeCompare(b.show.name)), [lists, showById]);

  // Posters + trailer availability, once per show.
  useEffect(() => {
    const want = [...proposals.map((p) => p.show), ...listRows.map((r) => r.show)];
    for (const s of want) {
      if (!s.tvmazeId || asked.current.has(s.id)) continue;
      asked.current.add(s.id);
      fetchTvmazePoster(s.tvmazeId).then((url) => setPosters((p) => ({ ...p, [s.id]: url }))).catch(() => {});
      getTrailerKeyCached(s.id, Number(s.tvmazeId)).then((k) => setTrailerOk((p) => ({ ...p, [s.id]: !!k }))).catch(() => {});
    }
  }, [proposals, listRows]);

  const excludeTvmazeIds = useMemo(() => {
    const ids = new Set<number>();
    for (const g of dash ?? []) { const tv = showById[g.showId]?.tvmazeId; if (tv) ids.add(Number(tv)); }
    for (const r of listRows) if (r.show.tvmazeId) ids.add(Number(r.show.tvmazeId));
    return ids;
  }, [dash, showById, listRows]);

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy((b) => new Set(b).add(key));
    try { await fn(); } catch (e) { console.warn("[whats-next]", e); }
    finally { setBusy((b) => { const n = new Set(b); n.delete(key); return n; }); }
  };

  /** Your yes/no on a show already in the catalog: the vote, mirrored at once. */
  const vote = (showId: string, on: boolean) => withBusy(showId, async () => {
    setDash((d) => {
      const cur = d ?? [];
      const has = cur.some((g) => g.showId === showId);
      const next = has ? cur.map((g) => g.showId !== showId ? g : {
        ...g,
        members: on
          ? (g.members.some((m) => m.userId === userId) ? g.members.map((m) => m.userId === userId ? { ...m, voted: true } : m) : [...g.members, { userId, voted: true, s: null, e: null, wrote: false, wroteEntryMinS: null, wroteEntryMinE: null }])
          : g.members.filter((m) => m.userId !== userId),
      }) : [...cur, { showId, roomId: null, inRoom: false, viewerLeft: false, lastActivityAt: null, members: [{ userId, voted: true, s: null, e: null, wrote: false, wroteEntryMinS: null, wroteEntryMinE: null }] }];
      return next.filter((g) => g.roomId || g.members.length > 0);
    });
    setLists((l) => { if (!l[showId]) return l; const n = { ...l }; delete n[showId]; return n; });
    await setShowVote(groupId, showId, on);
    if (on) await ensureProgressRow(userId, showId);
  });

  /** A browse pick Sidebar doesn't have yet: create its catalog row, then vote. */
  const proposeNew = (b: BrowseShow) => withBusy(`tv-${b.tvmazeId}`, async () => {
    const seasons = await tvmazeEpisodes(b.tvmazeId);
    const created = await createShow({ id: slugify(b.name), name: b.name, seasons, tvmazeId: String(b.tvmazeId) });
    setShows((s) => (s.some((x) => x.id === created.id) ? s : [...s, created]));
    await vote(created.id, true);
    setCard((c) => (c && c.tvmazeId === b.tvmazeId ? { ...c, id: created.id, catalogId: created.id } : c));
  });

  const start = (showId: string) => withBusy(`start-${showId}`, async () => {
    const { roomId } = await startShowRoom(groupId, showId);
    onOpenRoom?.(roomId, showId);
  });

  const selfIn = (voters: string[]) => voters.includes(userId);
  const caption = (voters: string[]) => {
    const others = voters.filter((v) => v !== userId).map(nameOf);
    if (selfIn(voters)) return others.length ? `${joinNames(["You", ...others])} are in` : "You proposed this";
    return others.length ? `${joinNames(others)} ${others.length === 1 ? "is" : "are"} in` : "Proposed here";
  };
  const listCaption = (owners: string[]) => {
    const labels = owners.map((o) => (o === userId ? "your" : `${nameOf(o)}'s`));
    return `on ${joinNames(labels)} ${owners.length === 1 ? "list" : "lists"}`;
  };

  const catalogFor = (b: BrowseShow) => shows.find((s) => s.tvmazeId === String(b.tvmazeId)) ?? null;
  const cardVoted = card?.catalogId ? proposals.some((p) => p.show.id === card.catalogId && selfIn(p.voters)) : false;

  const dark = CANON.dark;
  const heading: React.CSSProperties = { fontFamily: INTER, fontSize: 14, fontWeight: 700, color: dark };
  const captionStyle: React.CSSProperties = { fontFamily: INTER, fontSize: mobile ? 12 : 13, lineHeight: 1.45, color: "rgba(26,58,74,0.7)" };
  const posterW = mobile ? 40 : 44, posterH = mobile ? 56 : 62;
  const startPill: React.CSSProperties = { padding: mobile ? "5px 12px" : "8px 16px", minHeight: mobile ? 28 : 36, borderRadius: 9999, background: CANON.identity, color: CANON.cream, fontFamily: INTER, fontWeight: 700, fontSize: mobile ? 12 : 13, border: "none", cursor: "pointer", flexShrink: 0 };
  const ghostPill: React.CSSProperties = { padding: "6px 14px", minHeight: 32, borderRadius: 9999, background: "transparent", color: "rgba(26,58,74,0.85)", fontFamily: INTER, fontWeight: 700, fontSize: 12, border: "2px solid rgba(26,58,74,0.4)", cursor: "pointer", flexShrink: 0 };

  const poster = (show: Show) => {
    const url = posters[show.id];
    return url
      ? <img src={url} alt="" style={{ width: posterW, height: posterH, borderRadius: 6, objectFit: "cover", flexShrink: 0, display: "block" }} />
      : <div aria-hidden style={{ width: posterW, height: posterH, borderRadius: 6, background: CANON.cream, color: dark, fontFamily: INTER, fontSize: 9, lineHeight: 1.2, textAlign: "center", padding: 4, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>{show.name}</div>;
  };
  const titleLine = (show: Show) => (
    <div style={{ fontFamily: INTER, fontSize: 15, fontWeight: 600, color: dark }}>
      {show.name}
      {trailerOk[show.id] && show.tvmazeId && (
        <>
          <span style={{ fontWeight: 400, color: "rgba(26,58,74,0.7)" }}> · </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setCard({ id: show.id, name: show.name, tvmazeId: Number(show.tvmazeId), catalogId: show.id }); }}
            style={{ background: "none", border: "none", padding: 0, fontFamily: INTER, fontSize: 15, fontWeight: 400, color: "rgba(26,58,74,0.85)", textDecoration: "underline", textUnderlineOffset: 2, cursor: "pointer" }}
          >trailer</button>
        </>
      )}
    </div>
  );

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 14, borderTop: "2px solid rgba(254,248,234,0.6)", paddingTop: mobile ? 14 : 18, display: "flex", flexDirection: "column", gap: mobile ? 18 : 22 }}>
      {failed && <div style={captionStyle}>Couldn't load the group's shows just now.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={heading}>Already proposed in this group:</div>
        {dash === null && !failed && <div style={captionStyle}>loading…</div>}
        {dash !== null && proposals.length === 0 && <div style={captionStyle}>Nothing proposed yet — say yes to something below.</div>}
        {proposals.map(({ show, voters }) => {
          const mine = selfIn(voters);
          const isBusy = busy.has(show.id) || busy.has(`start-${show.id}`);
          return (
            <div key={show.id} style={{ display: "flex", alignItems: "center", gap: mobile ? 12 : 14, opacity: isBusy ? 0.6 : 1 }}>
              {poster(show)}
              <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: mobile ? 4 : 2 }}>
                {titleLine(show)}
                <div style={captionStyle}>{caption(voters)}</div>
                {mobile && mine && <button type="button" style={{ ...startPill, alignSelf: "flex-start" }} disabled={isBusy} onClick={() => start(show.id)}>start the room</button>}
              </div>
              <YesNoToggle value={mine} onChange={(v) => { if (!isBusy) vote(show.id, v); }} />
              {!mobile && (mine
                ? <button type="button" style={startPill} disabled={isBusy} onClick={() => start(show.id)}>start the room</button>
                : <span style={{ width: 118, flexShrink: 0 }} />)}
            </div>
          );
        })}
      </div>

      {listRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ ...heading, color: "rgba(26,58,74,0.75)" }}>From your personal lists:</div>
          {listRows.map(({ show, owners }) => (
            <div key={show.id} style={{ display: "flex", alignItems: "center", gap: 12, opacity: busy.has(show.id) ? 0.6 : 1 }}>
              <div style={{ flexGrow: 1, minWidth: 0, fontFamily: INTER, fontSize: 14, color: "rgba(26,58,74,0.75)" }}>{show.name} · {listCaption(owners)}</div>
              <button type="button" style={ghostPill} disabled={busy.has(show.id)} onClick={() => vote(show.id, true)}>propose</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={heading}>Or find something new</div>
        <div style={{ textAlign: "left" }}>
          {mobile
            ? <MobileBrowseRows excludeTvmazeIds={excludeTvmazeIds} onPick={(b) => { const cat = catalogFor(b); setCard({ id: cat ? cat.id : `tv-${b.tvmazeId}`, name: b.name, tvmazeId: b.tvmazeId, catalogId: cat ? cat.id : null }); }} />
            : <BrowseRows excludeTvmazeIds={excludeTvmazeIds} onPick={(b) => { const cat = catalogFor(b); setCard({ id: cat ? cat.id : `tv-${b.tvmazeId}`, name: b.name, tvmazeId: b.tvmazeId, catalogId: cat ? cat.id : null }); }} />}
        </div>
        <div style={captionStyle}>Tap a poster for its trailer, then say yes or no.</div>
      </div>

      {card && (
        <InviteShowCard idiom={mobile ? "mobile" : "desktop"} show={{ id: card.id, name: card.name, tvmazeId: card.tvmazeId }} onClose={() => setCard(null)}>
          <div style={{ color: CANON.cream, fontSize: 15, fontWeight: 600, textAlign: "center" }}>Do you want to watch this?</div>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
            <YesNoToggle
              value={cardVoted}
              onChange={(v) => {
                if (card.catalogId) { vote(card.catalogId, v); return; }
                if (v) proposeNew({ tvmazeId: card.tvmazeId, name: card.name, imageUrl: null, channel: null });
              }}
            />
          </div>
        </InviteShowCard>
      )}
    </div>
  );
}
