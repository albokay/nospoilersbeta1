import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchGroupDashboard, fetchShows, fetchPeopleGroupMembers, fetchContactNames, fetchPublicProgressForUser, fetchBrowseAutoRows,
  setShowVote, ensureProgressRow, startShowRoom, createShow,
  type Show, type GroupDashboardShow, type BrowseShow,
} from "../lib/db";
import { tvmazeEpisodes, slugify, fetchTvmazePoster, tvmazeSearch, networkLabel, type TVmazeShow } from "../lib/tvmaze";
import { getTrailerKeyCached } from "../lib/trailers";
import { personDisplayName, joinNames } from "../lib/groupNames";
import { CANON } from "../styles/canon";
import YesNoToggle from "./YesNoToggle";
import InviteShowCard from "./InviteShowCard";

/**
 * WhatsNextPanel (letters from Sidebar, Alborz 2026-09-28): the opt-in moment
 * under the "what's next" letter. Three parts, in his order: the group's
 * proposals (poster, "Name · trailer", who's in, the yes/no toggle, "start
 * the room" once you're in), then the members' own lists (quieter, a
 * "propose" button), then a browse strip whose posters open the trailer
 * card with a yes/no toggle — yes proposes the show here, creating its
 * catalog row when Sidebar doesn't have it yet (the invite landing's path).
 * The strip is the panel's own (small posters, sideways scroll): the
 * dashboard's browse rows are sized for a full page and overflowed the
 * ticket (Alborz 2026-09-28). "Your lists" = the dashboard's "You want to
 * watch" shelf, i.e. the wanted stamp with progress still at zero (his
 * 09-28 note: the old in-pool rows from testing were never on a shelf).
 * Both idioms; the ticket's dark-on-sky palette.
 */
type Member = { userId: string; username: string; displayName?: string | null };
type Card = { id: string; name: string; tvmazeId: number; catalogId: string | null };

const INTER = '"Inter", sans-serif';

export default function WhatsNextPanel({ groupId, userId, mobile = false, onOpenRoom, searchOpen = false }: {
  groupId: string;
  userId: string;
  mobile?: boolean;
  onOpenRoom?: (roomId: string, showId: string) => void;
  /** The letter's "Search for a show…" button (its Highlight slot): opens
   *  the search field above the browse strip and focuses it. */
  searchOpen?: boolean;
}) {
  const [dash, setDash] = useState<GroupDashboardShow[] | null>(null);
  const [shows, setShows] = useState<Show[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [contactNames, setContactNames] = useState<Record<string, string>>({});
  const [lists, setLists] = useState<Record<string, string[]>>({});
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [trailerOk, setTrailerOk] = useState<Record<string, boolean>>({});
  const [card, setCard] = useState<Card | null>(null);
  const [browse, setBrowse] = useState<BrowseShow[]>([]);
  const [query, setQuery] = useState("");
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<number | null>(null);
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
        // The members' "You want to watch" shelves (lib/reference.ts): the
        // wanted stamp set, progress still at zero, not stopped, not hidden,
        // and not already in this group.
        const inGroup = new Set(d.map((g) => g.showId));
        const owners: Record<string, string[]> = {};
        await Promise.all(m.map(async (mem) => {
          try {
            const prog = await fetchPublicProgressForUser(mem.userId);
            for (const [showId, p] of Object.entries(prog)) {
              if (!p.wantedAt || (p.s ?? 0) > 0 || (p.e ?? 0) > 0 || p.stoppedWatching || p.shelfHiddenAt || inGroup.has(showId)) continue;
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
  useEffect(() => {
    let cancelled = false;
    fetchBrowseAutoRows().then((r) => { if (!cancelled) setBrowse([...r.popular, ...r.startingUp]); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // The search field: catalog matches at once, TVMaze after a short pause
  // (the invite landing's search, minus the parking).
  useEffect(() => {
    if (!searchOpen) return;
    window.setTimeout(() => {
      searchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      inputRef.current?.focus();
    }, 60);
  }, [searchOpen]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setTvResults([]); return; }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    let cancelled = false;
    debounceRef.current = window.setTimeout(async () => {
      try { const r = await tvmazeSearch(q); if (!cancelled) setTvResults(r); }
      catch { if (!cancelled) setTvResults([]); }
    }, 320);
    return () => { cancelled = true; if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [query]);

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
  const inGroupIds = useMemo(() => new Set((dash ?? []).map((g) => g.showId)), [dash]);
  const catalogMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Show[];
    return shows.filter((s) => !s.isHidden && !inGroupIds.has(s.id) && s.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, shows, inGroupIds]);
  const tvMatches = useMemo(() => {
    const known = new Set(shows.map((s) => s.id));
    const seen = new Set<string>();
    const out: TVmazeShow[] = [];
    for (const tv of tvResults) {
      const id = slugify(tv.name);
      if (known.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(tv);
      if (out.length >= 6) break;
    }
    return out;
  }, [tvResults, shows]);
  const strip = useMemo(() => {
    const seen = new Set<number>();
    const out: BrowseShow[] = [];
    for (const b of browse) {
      if (seen.has(b.tvmazeId) || excludeTvmazeIds.has(b.tvmazeId)) continue;
      seen.add(b.tvmazeId);
      out.push(b);
      if (out.length >= 14) break;
    }
    return out;
  }, [browse, excludeTvmazeIds]);

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
  const stripW = mobile ? 52 : 60, stripH = mobile ? 74 : 84;
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

      <div ref={searchRef} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={heading}>Or find something new</div>
        {searchOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a show"
              aria-label="Search for a show"
              style={{ width: "100%", boxSizing: "border-box", height: 40, borderRadius: 9999, border: "none", background: CANON.cream, color: dark, fontFamily: INTER, fontSize: 15, padding: "0 16px", outline: "none" }}
            />
            {(catalogMatches.length > 0 || tvMatches.length > 0) && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {catalogMatches.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { if (s.tvmazeId) setCard({ id: s.id, name: s.name, tvmazeId: Number(s.tvmazeId), catalogId: s.id }); else vote(s.id, true); }}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid rgba(26,58,74,0.15)", padding: "9px 4px", cursor: "pointer", fontFamily: INTER, color: dark }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{s.name}</span>
                    <span style={{ fontSize: 13, color: "rgba(26,58,74,0.7)", flexShrink: 0 }}>{s.tvmazeId ? "trailer" : "propose"}</span>
                  </button>
                ))}
                {tvMatches.map((tv) => (
                  <button
                    key={tv.id}
                    type="button"
                    onClick={() => setCard({ id: `tv-${tv.id}`, name: tv.name, tvmazeId: tv.id, catalogId: null })}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid rgba(26,58,74,0.15)", padding: "9px 4px", cursor: "pointer", fontFamily: INTER, color: dark }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{tv.name}{networkLabel(tv) ? <span style={{ fontWeight: 400, color: "rgba(26,58,74,0.7)" }}> · {networkLabel(tv)}</span> : null}</span>
                    <span style={{ fontSize: 13, color: "rgba(26,58,74,0.7)", flexShrink: 0 }}>trailer</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch" }}>
          {strip.map((b) => (
            <button
              key={b.tvmazeId}
              type="button"
              aria-label={`Open the trailer for ${b.name}`}
              onClick={() => { const cat = catalogFor(b); setCard({ id: cat ? cat.id : `tv-${b.tvmazeId}`, name: b.name, tvmazeId: b.tvmazeId, catalogId: cat ? cat.id : null }); }}
              style={{ flex: "0 0 auto", width: stripW, height: stripH, borderRadius: 6, overflow: "hidden", border: "none", padding: 0, background: CANON.cream, cursor: "pointer" }}
            >
              {b.imageUrl
                ? <img src={b.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                : <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", fontFamily: INTER, fontSize: 9, lineHeight: 1.2, color: dark, padding: 4, boxSizing: "border-box", textAlign: "center" }}>{b.name}</span>}
            </button>
          ))}
          {strip.length === 0 && <div style={captionStyle}>Nothing to browse right now.</div>}
        </div>
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
