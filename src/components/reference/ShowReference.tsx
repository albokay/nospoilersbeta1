// ShowReference — the spoiler-gated reference tab's body (CP1, 2026-09-05).
// Shared by the desktop + mobile show pages (idiom prop sizes it). Renders a
// show's cached reference index gated to the VIEWER'S OWN progress: watched
// episodes in full, everything past the dial as folded shape-only cells (the
// season map's disclosure rule — shape visible, contents not). Copy locked
// by Alborz 2026-09-05. Never rendered below S1E1 (the tab is hidden until
// the dial reaches it — "no 0-state reference page").

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Lock, Star } from "lucide-react";
import StickyNote from "../StickyNote";
import { CANON } from "../../styles/canon";
import { E } from "../../styles/editorial";
import { SectionHead, UnderlineWord } from "../editorial/Chrome";
import { SelectWord } from "../editorial/ShowRoom";
import LoadingDots from "../LoadingDots";
import { ensureShowReference, stampReferenceLookup, toCredit, type ShowReferenceData } from "../../lib/reference";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabaseClient";
import { setEssentialEps, fetchFriendGroupsForUser, fetchPeopleGroupsForUser, fetchPeopleGroupMembers, fetchContactNames, fetchShows, upsertEpisodeRating, deleteEpisodeRating } from "../../lib/db";
import StarFace from "../v2/StarFace";
import { RATING_LABELS } from "../RatingCaptureModal";
import type { Show } from "../../lib/db";
import { groupDisplayName, joinNames } from "../../lib/groupNames";
import { M } from "../../mobile/m";
import { D } from "../dashboardChrome";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

/** Paragraphs for a long summary (his note, 2026-10-31): the blob holds
 *  each summary as one line (the builder collapses whitespace), and a long
 *  one reads as a block. Cut at sentence ends — not after Mr., Dr., an
 *  initial or the like — then group the sentences into paragraphs of
 *  about equal length, aiming at ~280 characters each; anything under 320
 *  stays whole. The breaks are arbitrary by design: scan-ability over
 *  sense, his call. */
const ABBREV = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Lt|Sgt|Gen|Col|Capt|Prof|Mt|vs|No|Op|Vol|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|[A-Z])\.$/;
export function summaryParagraphs(text: string): string[] {
  const t = text.trim();
  if (t.length < 320) return [t];
  // Sentence ends: . ! ? (with a closing quote or bracket), then a space,
  // then a capital, digit or opening quote.
  const parts = t.split(/(?<=[.!?]["”’)\]]?)\s+(?=["“‘(\[]?[A-Z0-9])/);
  const sentences: string[] = [];
  for (const p of parts) {
    const last = sentences[sentences.length - 1];
    if (last !== undefined && ABBREV.test(last)) sentences[sentences.length - 1] = `${last} ${p}`;
    else sentences.push(p);
  }
  if (sentences.length < 2) return [t];
  const total = t.length;
  const k = Math.min(sentences.length, Math.max(2, Math.round(total / 280)));
  const out: string[] = [];
  let cur: string[] = [];
  let len = 0;
  let n = 0;
  for (let i = 0; i < sentences.length; i++) {
    const sn = sentences[i];
    const remainingParas = k - out.length;
    const remainingSentences = sentences.length - i;
    // Close the paragraph once it has reached its share — but never leave
    // fewer sentences than paragraphs still to fill.
    const share = (total - n) / remainingParas;
    if (cur.length > 0 && remainingParas > 1 && remainingSentences >= remainingParas && len + sn.length / 2 > share) {
      out.push(cur.join(" ")); n += len; cur = []; len = 0;
    }
    cur.push(sn); len += sn.length + 1;
  }
  if (cur.length) out.push(cur.join(" "));
  // A short tail (under 80 characters) joins the paragraph before it.
  if (out.length > 1 && out[out.length - 1].length < 80) { const tail = out.pop()!; out[out.length - 1] += ` ${tail}`; }
  return out;
}

/** The sheet's margin counts (2026-10-31): the room's letters and the
 *  viewer's journal entries by the episode they're stamped on — a binge
 *  letter counts on the episode it's sealed at (the range's end). */
export function episodeWritingCounts(
  letters: { s: number; e: number; isDeleted?: boolean; isInstructional?: boolean }[],
  journal: { season: number; episode: number; isDeleted?: boolean }[],
): Map<string, { letters: number; journal: number }> {
  const out = new Map<string, { letters: number; journal: number }>();
  const at = (s: number, e: number) => { const k = `${s}-${e}`; let c = out.get(k); if (!c) { c = { letters: 0, journal: 0 }; out.set(k, c); } return c; };
  for (const l of letters) if (!l.isDeleted && !l.isInstructional) at(l.s, l.e).letters += 1;
  for (const j of journal) if (!j.isDeleted) at(j.season, j.episode).journal += 1;
  return out;
}
const CREAM = CANON.cream;
const idx = (s: number, e: number) => s * 10000 + e;
type RefSeasonLike = { n: number; episodes: { s: number; e: number }[] };

export default function ShowReference({
  showId, viewerProgress, mobile = false, nudgeEssentials = false, showRoomLinks = false, editorial = false, onRated, episodeCounts, railHost,
}: {
  /** The desktop rail (the guide redesign, 2026-10-31): the room page hands
   *  the guide its right pane, and the trailers (first, so a long-running
   *  show never pushes them down — his call) and the season strips render
   *  there instead of under the sheet. */
  railHost?: HTMLElement | null;
  /** The sheet's margin counts (the guide redesign, 2026-10-31): the room's
   *  letters and the viewer's journal entries by the episode they're stamped
   *  on, "s-e" → counts; see episodeWritingCounts. */
  episodeCounts?: Map<string, { letters: number; journal: number }>;
  /** Rating from the guide (2026-10-22): fires after a rating lands (null =
   *  cleared), so the room can patch its own map cell in place — no reload,
   *  the viewer keeps rating and scrolling. */
  onRated?: (season: number, episode: number, rating: number | null) => void;
  /** The editorial skin (checkpoint 4, 2026-10-12; the bible's GuideRows):
   *  the same guide as hairline rows in ink — the stops line, CAST with the
   *  as-of episode, PLOT SO FAR in Lora, EPISODES with Watched / You are
   *  here / After you watch it (the unwatched rows keep their titles back,
   *  as the live guide does), the trailers. */
  editorial?: boolean;
  showId: string;
  /** The viewer's EFFECTIVE progress (rewatch-aware ceiling) — ≥ S1E1. */
  viewerProgress: { s: number; e: number };
  mobile?: boolean;
  /** Arrived via the dashboard's "pick its essential episodes" prompt —
   *  always re-show the essentials sticky, even if it was X'd out. */
  nudgeEssentials?: boolean;
  /** Standalone (dashboard-route) guide: link out to the viewer's open show
   *  rooms for this show (one pill per friend-group room). */
  showRoomLinks?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ref, setRef] = useState<ShowReferenceData | null>(null);
  const [failed, setFailed] = useState(false);
  // Cast shows the SELECTED episode only (Alborz 2026-09-05 rev 2): 8 actors
  // folded; "see whole cast" expands to that episode's full credit list.
  const [castExpanded, setCastExpanded] = useState(false);
  // Default = the viewer's current episode; a simple dropdown picks any
  // WATCHED episode (switching re-folds to 8).
  const [castEpisode, setCastEpisode] = useState<{ s: number; e: number } | null>(null);
  // Previously-on seasons collapse like the map's (Alborz 2026-09-05):
  // only the viewer's CURRENT season starts open; any watched season
  // toggles via its header. null = untouched → the default tracks the
  // dial; per-visit state, no persistence.
  const [openSeasons, setOpenSeasons] = useState<Set<number> | null>(null);
  // Tapped episode still → lightbox (dim + a larger render; outside-click
  // closes). Holds the SMALL url; the render upgrades it to the source's
  // bigger size and falls back on a load error.
  const [stillOpen, setStillOpen] = useState<string | null>(null);
  // Canon (CP3 2026-09-07): the owner's add-to-canon + blurb controls live
  // HERE — the dashboard's canon shelf only displays. Reuses the old
  // profile's columns, so pre-restructure canon picks resurface.
  const [canonOn, setCanonOn] = useState<boolean | null>(null); // null = loading
  // The essentials sticky (Alborz 2026-09-07 — the star feature read as
  // plain reference to new users): dismissible per show; the dashboard's
  // "pick its essential episodes" prompt always re-summons it.
  const stickyKey = `ns_ess_sticky_x_${showId}`;
  const [stickyVisible, setStickyVisible] = useState(false);
  // Open show rooms for this show (dashboard-route guide only) — one pill
  // per friend-group room, labeled by the group's display name.
  const [roomLinks, setRoomLinks] = useState<{ roomId: string; label: string }[]>([]);
  useEffect(() => {
    if (!user || !showRoomLinks) { setRoomLinks([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const rooms = await fetchFriendGroupsForUser(user.id, showId);
        if (!rooms.length) { if (!cancelled) setRoomLinks([]); return; }
        const [pgroups, contactNames] = await Promise.all([
          fetchPeopleGroupsForUser(user.id),
          fetchContactNames(user.id).catch(() => ({} as Record<string, string>)),
        ]);
        const links: { roomId: string; label: string }[] = [];
        for (const room of rooms) {
          let label = "your group";
          if (room.parentGroupId) {
            const pg = pgroups.find((g) => g.id === room.parentGroupId);
            const members = await fetchPeopleGroupMembers(room.parentGroupId);
            const others = members.filter((m) => m.userId !== user.id);
            label = pg
              ? groupDisplayName(pg, others, contactNames)
              : joinNames(others.map((m) => contactNames[m.userId] ?? m.displayName ?? m.username));
          }
          links.push({ roomId: room.id, label });
        }
        if (!cancelled) setRoomLinks(links);
      } catch { if (!cancelled) setRoomLinks([]); }
    })();
    return () => { cancelled = true; };
  }, [showId, user?.id, showRoomLinks]);
  // CP4: the owner's essential-episode stars (canon shows only) — epIndex set.
  const [essentials, setEssentials] = useState<Set<number>>(new Set());
  // Rating from the guide (Alborz 2026-10-22, the mockups on the canvas): the
  // viewer's own ratings by "s-e", the map's cell on every plot row, and
  // which row's picker is open. Rating never moves progress — the guide only
  // lists what's been reached.
  const [ratings, setRatings] = useState<Map<string, number>>(new Map());
  const [ratingOpen, setRatingOpen] = useState<string | null>(null);
  useEffect(() => {
    setRatings(new Map()); setRatingOpen(null);
    if (!user) return;
    let cancelled = false;
    supabase.from("episode_ratings").select("season_number, episode_number, rating").eq("user_id", user.id).eq("show_id", showId)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setRatings(new Map((data as any[]).map((r) => [`${r.season_number}-${r.episode_number}`, Number(r.rating)])));
      });
    return () => { cancelled = true; };
  }, [user?.id, showId]); // eslint-disable-line react-hooks/exhaustive-deps
  function setRating(s: number, e: number, n: number) {
    if (!user) return;
    const key = `${s}-${e}`;
    const prev = ratings.get(key) ?? null;
    setRatings((m) => { const next = new Map(m); if (n) next.set(key, n); else next.delete(key); return next; });
    setRatingOpen(null);
    const write = n
      ? upsertEpisodeRating({ userId: user.id, showId, season: s, episode: e, rating: n })
      : deleteEpisodeRating({ userId: user.id, showId, season: s, episode: e });
    write.then(() => onRated?.(s, e, n || null)).catch(() => {
      setRatings((m) => { const next = new Map(m); if (prev) next.set(key, prev); else next.delete(key); return next; });
    });
  }
  // Canon rule (Alborz 2026-09-07): adding a show to your canon SETS YOUR
  // PROGRESS to the latest catalog episode — canon means you've seen it all
  // (as of now). This local override reflects the jump immediately; the
  // host page's own copy refreshes on its next load.
  const [progressOverride, setProgressOverride] = useState<{ s: number; e: number } | null>(null);
  // Finished (Alborz, round 5 follow-up): the band's rule — at the show's
  // last catalog episode; the catalog row carries the aired counts.
  const [catalogShow, setCatalogShow] = useState<Show | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCatalogShow(null);
    fetchShows().then((rows) => { if (!cancelled) setCatalogShow(rows.find((x) => x.id === showId) ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [showId]);

  useEffect(() => {
    let cancelled = false;
    setRef(null);
    setFailed(false);
    setCastExpanded(false);
    setCastEpisode(null);
    setOpenSeasons(null);
    setStillOpen(null);
    setCanonOn(null);
    setEssentials(new Set());
    setProgressOverride(null);
    try {
      if (nudgeEssentials) localStorage.removeItem(stickyKey);
      setStickyVisible(nudgeEssentials || localStorage.getItem(stickyKey) !== "1");
    } catch { setStickyVisible(true); }
    ensureShowReference(showId)
      .then((r) => { if (!cancelled) setRef(r); })
      .catch(() => { if (!cancelled) setFailed(true); });
    // Feeds the dashboard band's "You've looked up:" row (cross-device).
    if (user) stampReferenceLookup(user.id, showId);
    return () => { cancelled = true; };
  }, [showId, user?.id]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("progress")
      .select("canon_pin, essential_eps")
      .eq("user_id", user.id)
      .eq("show_id", showId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setCanonOn(!!data?.canon_pin);
        setEssentials(new Set(Array.isArray(data?.essential_eps) ? data.essential_eps : []));
      });
    return () => { cancelled = true; };
  }, [showId, user?.id]);

  function toggleEssential(s: number, e: number) {
    if (!user || !canonOn) return;
    const key = idx(s, e);
    const next = new Set(essentials);
    if (next.has(key)) next.delete(key); else next.add(key);
    setEssentials(next);
    setEssentialEps(user.id, showId, [...next]).catch(() => { /* tolerate */ });
  }

  // The effective dial: the prop, unless a canon-add just jumped it.
  const prog = progressOverride ?? viewerProgress;
  const vIdx = idx(prog.s, prog.e);
  const seasonCounts = (catalogShow as { seasons?: number[] } | null)?.seasons;
  const finished = !!seasonCounts?.length && (prog.s > seasonCounts.length || (prog.s === seasonCounts.length && prog.e >= (seasonCounts[seasonCounts.length - 1] ?? 1)));
  // Arriving via the dashboard's "Pick its essential episodes →" (Alborz,
  // round 5 follow-up): the page lands with the top of "Plot so far" about
  // a third of the way down the screen. The room scrolls inside a fixed
  // container on the phone, so the nearest scroller is found first.
  const plotHeadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!nudgeEssentials || !editorial || !ref) return;
    const t = window.setTimeout(() => {
      const el = plotHeadRef.current;
      if (!el) return;
      let scroller: HTMLElement | null = el.parentElement;
      while (scroller && scroller !== document.body) {
        const oy = getComputedStyle(scroller).overflowY;
        if ((oy === "auto" || oy === "scroll") && scroller.scrollHeight > scroller.clientHeight) break;
        scroller = scroller.parentElement;
      }
      const top = el.getBoundingClientRect().top;
      if (scroller && scroller !== document.body) {
        const r = scroller.getBoundingClientRect();
        scroller.scrollBy({ top: top - (r.top + r.height / 3), behavior: "smooth" });
      } else {
        window.scrollBy({ top: top - window.innerHeight / 3, behavior: "smooth" });
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [nudgeEssentials, editorial, ref]);

  // Before the first episode (the guide opens on day one, Alborz
  // 2026-10-13) the cast billed from the pilot shows — the people on the
  // poster and in the trailer, not a spoiler.
  const castIdx = Math.max(vIdx, idx(1, 1));
  const visiblePeople = useMemo(
    () => (ref?.people ?? []).filter((p) => idx(p.firstS, p.firstE) <= castIdx),
    [ref, castIdx],
  );

  // Watched episodes (dropdown options) + the selected one, clamped to the
  // dial. Old cached blobs lack per-episode cast — those degrade to the
  // whole-cast view until the cache rebuilds.
  const watchedEpisodes = useMemo(() => {
    const out: { s: number; e: number; title: string }[] = [];
    for (const season of ref?.seasons ?? []) {
      for (const ep of season.episodes) {
        if (idx(ep.s, ep.e) <= vIdx) out.push({ s: ep.s, e: ep.e, title: ep.title });
      }
    }
    return out;
  }, [ref, vIdx]);
  // The plot by season (Alborz's notes, round 5): with more than one season
  // watched, each season folds; the season you're in starts open and opening
  // one closes the other.
  const [openPlotSeason, setOpenPlotSeason] = useState<number | null>(null);
  useEffect(() => { setOpenPlotSeason(prog.s); }, [prog.s]);
  const selCastEp = (castEpisode && idx(castEpisode.s, castEpisode.e) <= vIdx) ? castEpisode : prog;
  const selEpData = useMemo(
    () => ref?.seasons.find((se) => se.n === selCastEp.s)?.episodes.find((ep) => ep.e === selCastEp.e),
    [ref, selCastEp.s, selCastEp.e],
  );
  const peopleByName = useMemo(() => {
    const m = new Map<string, (typeof visiblePeople)[number]>();
    for (const person of ref?.people ?? []) m.set(person.name, person);
    return m;
  }, [ref]);
  const episodeCast = useMemo(() => {
    if (!selEpData?.cast) return null; // pre-rev blob → whole-cast fallback
    return selEpData.cast
      .map((n) => peopleByName.get(n) ?? { name: n, character: null, firstS: selCastEp.s, firstE: selCastEp.e, exact: true, img: null, tmdbId: null })
      .filter((person) => idx(person.firstS, person.firstE) <= vIdx);
  }, [selEpData, peopleByName, selCastEp.s, selCastEp.e, vIdx]);
  // The folded 8 (Alborz catch 2026-09-05): the data sources only know
  // season REGULARS (the same list for every episode of a season — verified
  // against TMDB's per-episode credits endpoint) plus THIS EPISODE's guest
  // stars. A plain first-8 was all regulars, so switching episodes changed
  // nothing visible. The fold reserves slots for the guests — up to 4
  // regulars, the rest this episode's guest cast; credit order preserved.
  const foldedCast = useMemo(() => {
    const list = episodeCast ?? visiblePeople;
    if (!episodeCast) return list.slice(0, 8);
    const regs = list.filter((person) => !person.exact);
    const guests = list.filter((person) => person.exact);
    const nRegs = Math.min(regs.length, Math.max(4, 8 - guests.length));
    return [...regs.slice(0, nRegs), ...guests.slice(0, 8 - nRegs)];
  }, [episodeCast, visiblePeople]);

  // Cast tap → the actor's IMDb page in a NEW tab. The tab opens
  // synchronously (popup-blocker rule), then lands on the exact page once
  // the person's IMDb id resolves; a resolve miss falls back to IMDb search.
  const openActorImdb = (person: { name: string; tmdbId?: number | null }) => {
    const win = window.open("", "_blank");
    if (!win) return;
    const fallback = `https://www.imdb.com/find/?q=${encodeURIComponent(person.name)}&s=nm`;
    const token = import.meta.env.VITE_TMDB_READ_TOKEN as string | undefined;
    if (!person.tmdbId || !token) { win.location.href = fallback; return; }
    fetch(`https://api.themoviedb.org/3/person/${person.tmdbId}/external_ids`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { win.location.href = d?.imdb_id ? `https://www.imdb.com/name/${d.imdb_id}/` : fallback; })
      .catch(() => { win.location.href = fallback; });
  };

  if (failed) {
    return (
      <div style={{ color: editorial ? E.color.ink : CREAM, fontSize: 14, lineHeight: 1.5, maxWidth: 460 }}>
        The show guide couldn&rsquo;t load just now. Try again in a minute.
      </div>
    );
  }
  if (!ref) {
    return (
      <div style={{ color: editorial ? E.color.ink : CREAM }}>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14 }}>
          building this show&rsquo;s guide<LoadingDots />
        </span>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6, fontStyle: "italic" }}>
          (first visit only — takes a few seconds)
        </div>
      </div>
    );
  }

  if (editorial) {
    const seasonsVisible = [...ref.seasons].filter((season) => season.n <= prog.s).sort((a, b) => a.n - b.n);
    // The cast as polaroids (the guide redesign, 2026-10-31, his canvas):
    // the episode's whole cast in a strip that scrolls sideways (the phone's
    // bleeds to the screen's edges; 14px under the cards keeps a drawn
    // scrollbar off them), each card tilted a little and sat a little
    // lower or higher; "See whole cast →" spreads them into rows (three on
    // the phone, five on desktop) and "Show fewer" folds them back. The
    // folded-8 rule stays for the classic guide only.
    const castAll = episodeCast ?? visiblePeople;
    const TILT = [-2.5, 2, -1.5, 2.5, -2, 1.5];
    const DROP = [0, 10, 0, 8, 4, 10];
    const polaroid = (p: (typeof visiblePeople)[number], n: number, small: boolean) => (
      <button
        key={p.name}
        type="button"
        onClick={() => openActorImdb(p)}
        title={`${p.name} on IMDb`}
        style={{ flex: small ? undefined : "0 0 108px", width: small ? "100%" : 108, boxSizing: "border-box", padding: small ? "7px 7px 10px" : "8px 8px 12px", background: E.color.cream, border: `1px solid ${E.color.ink}`, transform: `rotate(${TILT[n % TILT.length]}deg)`, marginTop: DROP[n % DROP.length], textAlign: "left", cursor: "pointer", color: E.color.ink, fontFamily: E.font.interface }}
      >
        {p.img
          ? <img src={`https://image.tmdb.org/t/p/w185${p.img}`} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
          : <span aria-hidden="true" style={{ display: "block", width: "100%", aspectRatio: "1 / 1", background: E.color.draft }} />}
        <span style={{ display: "block", marginTop: small ? 8 : 9, fontSize: 13, lineHeight: 1.25, fontWeight: 600 }}>{p.name}</span>
        {roleOf(p) && <span style={{ display: "block", marginTop: 3, fontSize: small ? 12 : 13, lineHeight: 1.3, color: E.color.inkMuted }}>{roleOf(p)}</span>}
      </button>
    );
    const roleOf = (p: (typeof visiblePeople)[number]) => {
      const since = idx(p.firstS, p.firstE) > idx(1, 1) ? (p.exact ? `since S${p.firstS} E${p.firstE}` : `since season ${p.firstS}`) : null;
      return [p.character, since].filter(Boolean).join(" · ") || null;
    };
    const plotEpisodes = seasonsVisible.flatMap((season) => season.episodes.filter((ep) => idx(ep.s, ep.e) <= vIdx));
    const plotSeasons = seasonsVisible.map((season) => ({ n: season.n, eps: season.episodes.filter((ep) => idx(ep.s, ep.e) <= vIdx) })).filter((season) => season.eps.length > 0);
    // The star on the plot (Alborz, round 5 follow-up): a line and a star
    // after each episode's label, for a show you've FINISHED that's in your
    // canon — the essentials live where their plot sits.
    const starAllowed = !!user && !!canonOn && finished;
    const ratingAllowed = !!user;
    const ratedCount = plotEpisodes.filter((ep) => ratings.has(`${ep.s}-${ep.e}`)).length;
    const circle = (size: number, on: boolean, extra?: React.CSSProperties): React.CSSProperties => ({
      width: size, height: size, borderRadius: "50%", border: `2px solid ${E.color.identity}`, background: on ? E.color.identity : "transparent",
      padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxSizing: "border-box", ...extra,
    });
    // The sheet (the guide redesign, 2026-10-31, his canvas + his notes the
    // same day): one ruled sheet per season under "Previously, on {show}."
    // — each watched episode is a title line "Ep. 4 · Title" in Lora with
    // the rating circle right after it (rated = the identity fill with cream
    // stars; unrated = the ring with a grey "?"; open = the filled ring),
    // then the still and the summary at the column's full width (the phone:
    // the still as a block six rules tall; desktop: a third of the column,
    // floated right, the words wrapping it), and a mono line counting the
    // letters and journal entries stamped on it (the pinned counts ride
    // along, his call). The still isn't tappable; the essentials star sits
    // on its top-left corner (outline only until starred — the still shows
    // through). The picker spans the column, 112px = four rules so the
    // lines under it keep their rhythm.
    const RULE = E.space.paperRule;
    const paper: React.CSSProperties = {
      backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${RULE - 1}px, ${E.color.inkLines} ${RULE - 1}px, ${E.color.inkLines} ${RULE}px)`,
      backgroundSize: `100% ${RULE}px`,
    };
    const onRule: React.CSSProperties = { lineHeight: `${RULE}px` };
    const starBtn = (ep: { s: number; e: number }, onStill: boolean) => {
      const starred = essentials.has(idx(ep.s, ep.e));
      return (
        <button
          type="button"
          onClick={() => toggleEssential(ep.s, ep.e)}
          aria-pressed={starred}
          title={starred ? "Un-star this essential" : "Star as an essential episode"}
          style={{ background: "transparent", border: 0, padding: 0, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, ...(onStill ? { position: "absolute", top: 4, left: 4 } : {}) }}
        >
          <Star size={onStill ? 22 : 16} color={E.color.accent} fill={starred ? E.color.accent : E.color.cream} strokeWidth={2} aria-hidden="true" />
        </button>
      );
    };
    const still = (ep: { s: number; e: number; still?: string | null }) => (
      <div style={mobile ? { position: "relative", width: "100%", height: RULE * 6 - 8, margin: "4px 0" } : { position: "relative", float: "right", width: 256, height: 144, margin: "4px 0 8px 20px" }}>
        <img src={ep.still!} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        {starAllowed && starBtn(ep, true)}
      </div>
    );
    const countsLine = (ep: { s: number; e: number }) => {
      const c = episodeCounts?.get(`${ep.s}-${ep.e}`);
      if (!c || (!c.letters && !c.journal)) return null;
      const parts: string[] = [];
      if (c.letters) parts.push(`${c.letters} ${c.letters === 1 ? "letter" : "letters"}`);
      if (c.journal) parts.push(`${c.journal} journal ${c.journal === 1 ? "entry" : "entries"}`);
      return <div style={{ ...E.type.label10, ...onRule, color: E.color.inkMuted }}>{parts.join(" · ")}</div>;
    };
    const plotEntry = (ep: { s: number; e: number; title: string; summary?: string | null; still?: string | null }, first: boolean) => {
      const rKey = `${ep.s}-${ep.e}`;
      const r = ratings.get(rKey) ?? 0;
      const open = ratingOpen === rKey;
      const circleBtn = (
        <button type="button" onClick={() => setRatingOpen(open ? null : rKey)} aria-expanded={open} aria-label={r ? `Rated: ${RATING_LABELS[r]}. Change it` : "Rate this episode"} title={r ? RATING_LABELS[r] : "Rate this episode"} style={circle(24, r > 0 || open)}>
          {r > 0 ? <StarFace rating={r} size={18} color={E.color.cream} /> : (!open && <span aria-hidden="true" style={{ fontFamily: E.font.interface, fontWeight: 600, fontSize: 13, lineHeight: 1, color: "rgba(26,58,74,0.45)" }}>?</span>)}
        </button>
      );
      return (
        <div key={rKey} style={{ marginTop: first ? 0 : RULE }}>
          {/* The title line (his notes, round 2): the circle to the LEFT of the
              words — on desktop hanging out beyond the column's edge, on the
              phone inline before "Ep. 2 · Title", where the line also sits on
              a cream band so no rule runs directly above or below the words. */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, minHeight: RULE, ...(mobile ? { background: E.color.cream, boxShadow: `0 -1px 0 ${E.color.cream}` } : {}) }}>
            {ratingAllowed && mobile && circleBtn}
            <span style={{ ...E.type.letterBody16, fontWeight: 700, ...onRule, minWidth: 0 }}>Ep. {ep.e} · {ep.title}</span>
            {starAllowed && !ep.still && starBtn(ep, false)}
            {ratingAllowed && !mobile && <span style={{ position: "absolute", left: -36, top: 2, display: "inline-flex" }}>{circleBtn}</span>}
          </div>
          {open && (
            // The picker: seven circles — the empty ring (no rating) then 1
            // to 6 — the chosen one filled, its words under ITS circle (the
            // first flush left, the last flush right). 112px tall = 4 rules.
            <div style={{ margin: "15px 0", padding: "12px 14px 10px", border: `1px solid ${E.color.ink}`, background: E.color.cream, boxSizing: "border-box" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", justifyItems: "center", gap: 6 }}>
                {[0, 1, 2, 3, 4, 5, 6].map((n) => {
                  const on = r === n;
                  return (
                    <button key={n} type="button" aria-pressed={on} aria-label={n ? RATING_LABELS[n] : "No rating"} title={n ? RATING_LABELS[n] : "No rating"} onClick={() => setRating(ep.s, ep.e, n)} style={circle(36, on)}>
                      {n > 0 && <StarFace rating={n} size={28} color={on ? E.color.cream : E.color.identity} />}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, marginTop: 8, minHeight: 14 }}>
                <span style={{ ...E.type.label10, color: E.color.ink, gridColumn: r + 1, justifySelf: r === 0 ? "start" : r === 6 ? "end" : "center", width: "max-content", whiteSpace: "nowrap" }}>{r ? RATING_LABELS[r] : "No rating"}</span>
              </div>
            </div>
          )}
          <div style={{ display: "flow-root" }}>
            {ep.still && still(ep)}
            {ep.summary && summaryParagraphs(ep.summary).map((para, i) => (
              <div key={i} style={{ ...E.type.letterBody15, ...onRule, marginTop: i === 0 ? 0 : RULE }}>{para}</div>
            ))}
            {countsLine(ep)}
          </div>
        </div>
      );
    };
    // One season's sheet: its watched episodes, and for the season you're
    // in the "You are here" rule with the rest dimmed, "After you watch it".
    const sheetFor = (season: { n: number; eps: typeof plotEpisodes }) => {
      const data = ref.seasons.find((x) => x.n === season.n);
      const ahead = season.n === prog.s ? (data?.episodes ?? []).filter((ep) => idx(ep.s, ep.e) > vIdx) : [];
      return (
        <div style={{ ...paper, marginTop: 16 }}>
          {/* The season's name heads its column on desktop (his note; on the
              phone the strip right above already names it). */}
          {!mobile && <div style={{ ...E.type.letterTitle22, fontSize: 18, ...onRule, color: E.color.ink }}>Season {season.n}</div>}
          {season.eps.map((ep, n) => plotEntry(ep, n === 0 && mobile))}
          {ahead.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: RULE, height: RULE }}>
                <span style={{ ...E.type.label10, color: E.color.ink, whiteSpace: "nowrap" }}>You are here · S{prog.s} E{prog.e}</span>
                <span aria-hidden="true" style={{ flex: 1, height: 1, background: E.color.ink }} />
              </div>
              {ahead.map((ep) => (
                <div key={ep.e} style={{ ...E.type.body14, ...onRule, color: "rgba(26,58,74,0.45)" }}>Ep. {ep.e} · After you watch it</div>
              ))}
            </>
          )}
        </div>
      );
    };
    // The seasons (his notes, 2026-10-31). Every season up to the next
    // unwatched one, which is sealed with a red lock. On the PHONE they're
    // strips inline with the sheets — Season 1, its episodes, Season 2… —
    // tapping one opens it and closes the rest; tapping the open one closes
    // them all. On DESKTOP they sit in the rail as tabs: the season in view
    // is the cream tab with an ink outline, the others greyed and indented
    // (one is always in view). A one-season show gets no strips.
    const strips = [...ref.seasons].filter((season) => season.n <= prog.s + 1 && season.episodes.length > 0).sort((a, b) => a.n - b.n);
    const openSeason = plotSeasons.find((x) => x.n === openPlotSeason) ?? null;
    // The sheet in view on desktop (always one): the opened season, else the latest watched.
    const sheetSeason = plotEpisodes.length === 0 ? null : (openSeason ?? plotSeasons[plotSeasons.length - 1]);
    const stripCount = (season: RefSeasonLike) => {
      const watched = plotSeasons.find((x) => x.n === season.n);
      const total = season.episodes.length;
      return watched && watched.eps.length < total ? `${watched.eps.length} of ${total}` : `${total} ${total === 1 ? "episode" : "episodes"}`;
    };
    const phoneStrip = (season: RefSeasonLike) => {
      const watched = plotSeasons.find((x) => x.n === season.n);
      const open = !!watched && openPlotSeason === season.n;
      return (
        <button
          key={season.n}
          type="button"
          disabled={!watched}
          onClick={() => setOpenPlotSeason(open ? null : season.n)}
          aria-expanded={watched ? open : undefined}
          aria-label={watched ? `Season ${season.n}` : `Season ${season.n}, sealed until you finish season ${season.n - 1}`}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", padding: "13px 0", background: "transparent", border: 0, borderBottom: `1px solid ${E.color.hairline}`, ...E.type.label11, color: E.color.ink, cursor: watched ? "pointer" : "default", textAlign: "left" }}
        >
          <span>Season {season.n}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, color: E.color.inkMuted }}>
            {stripCount(season)}
            {!watched
              ? <Lock size={14} color={E.color.alert} strokeWidth={1.8} aria-hidden="true" />
              : open ? <ChevronUp size={14} color={E.color.ink} strokeWidth={2.25} aria-hidden="true" /> : <ChevronDown size={14} color={E.color.ink} strokeWidth={2.25} aria-hidden="true" />}
          </span>
        </button>
      );
    };
    const railTabs = sheetSeason && strips.length > 1 ? (
      <div>
        <SectionHead style={{ marginTop: 44 }}>Seasons</SectionHead>
        {strips.map((season, i) => {
          const watched = plotSeasons.find((x) => x.n === season.n);
          const on = sheetSeason.n === season.n;
          return (
            <button
              key={season.n}
              type="button"
              disabled={!watched || on}
              onClick={() => setOpenPlotSeason(season.n)}
              aria-pressed={on}
              aria-label={watched ? `Season ${season.n}` : `Season ${season.n}, sealed until you finish season ${season.n - 1}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, boxSizing: "border-box", width: on ? "100%" : "calc(100% - 40px)", marginLeft: on ? 0 : 40, padding: "13px 12px 13px 16px", background: on ? E.color.cream : E.color.draft, border: 0, borderLeft: on ? `1px solid ${E.color.ink}` : 0, borderBottom: on ? `1px solid ${E.color.ink}` : 0, borderTop: on && i > 0 ? `1px solid ${E.color.ink}` : 0, ...E.type.label11, color: on ? E.color.ink : E.color.inkMuted, cursor: watched && !on ? "pointer" : "default", textAlign: "left" }}
            >
              <span>Season {season.n}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, color: E.color.inkMuted }}>
                {stripCount(season)}
                {!watched && <Lock size={14} color={E.color.alert} strokeWidth={1.8} aria-hidden="true" />}
              </span>
            </button>
          );
        })}
      </div>
    ) : null;
    const trailersNode = (ref.launchTrailerKey || ref.seasons.some((season) => season.n >= 2 && season.trailerKey)) ? (
      <>
        <SectionHead style={railHost ? undefined : { marginTop: 28 }}>Trailers</SectionHead>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560, marginTop: 14 }}>
          {ref.launchTrailerKey && <RefTrailer label="the launch trailer" trailerKey={ref.launchTrailerKey} editorial />}
          {ref.seasons.filter((season) => season.n >= 2 && season.trailerKey).map((season) => {
            const prev = ref.seasons.find((x) => x.n === season.n - 1);
            const prevLast = prev?.episodes[prev.episodes.length - 1];
            const unlocked = !!prevLast && vIdx >= idx(prevLast.s, prevLast.e);
            if (unlocked) return <RefTrailer key={season.n} label={`season ${season.n}`} trailerKey={season.trailerKey!} editorial />;
            if (season.n === prog.s + 1) {
              return <div key={season.n} style={{ ...E.type.label11, letterSpacing: "0.06em", color: E.color.inkMuted }}>The season {season.n} trailer unlocks when you finish season {season.n - 1}.</div>;
            }
            return null;
          })}
        </div>
      </>
    ) : null;
    return (
      <div style={{ color: E.color.ink, fontFamily: E.font.interface, paddingBottom: 80 }}>
        {/* The room link above the stop line, the group's name in quotes
            (Alborz's notes, round 5). */}
        {user && roomLinks.length > 0 && (
          <div style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 18 }}>
            {roomLinks.map((r) => (
              <UnderlineWord key={r.roomId} onClick={() => navigate(`${mobile ? "/m" : ""}/show-room/${r.roomId}`)} title={`Open your show room with ${r.label}`}>Open your room with &ldquo;{r.label}&rdquo; →</UnderlineWord>
            ))}
          </div>
        )}
        <div style={{ ...E.type.label11, letterSpacing: "0.06em", color: E.color.inkMuted }}>{vIdx < idx(1, 1) ? "Nothing watched yet. Everything below is safe before S1 E1." : `Everything below stops at S${prog.s} E${prog.e}. Nothing past it.`}</div>
        {user && canonOn && (
          <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 18 }}>
            <UnderlineWord onClick={() => navigate(mobile ? "/m/dashboard" : "/dashboard", { state: { scrollToCanon: true } })} title="See your canon on the dashboard">In your canon →</UnderlineWord>
          </div>
        )}
        {visiblePeople.length > 0 && (
          <>
            <SectionHead style={{ marginTop: 22 }} right={episodeCast ? (
              <SelectWord
                ariaLabel="Cast as of episode"
                label={`S${selCastEp.s} E${selCastEp.e}`}
                value={`${selCastEp.s}-${selCastEp.e}`}
                onChange={(v) => { const [ss, ee] = v.split("-").map(Number); setCastEpisode({ s: ss, e: ee }); setCastExpanded(false); }}
              >
                {[...new Set(watchedEpisodes.map((ep) => ep.s))].map((sn) => (
                  <optgroup key={sn} label={`Season ${sn}`}>
                    {watchedEpisodes.filter((ep) => ep.s === sn).map((ep) => (
                      <option key={`${ep.s}-${ep.e}`} value={`${ep.s}-${ep.e}`}>S{ep.s} E{ep.e} · {ep.title}</option>
                    ))}
                  </optgroup>
                ))}
              </SelectWord>
            ) : null}>{episodeCast || vIdx < idx(1, 1) ? "Cast" : "Cast so far"}</SectionHead>
            {castExpanded ? (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${mobile ? 3 : 5}, minmax(0, 1fr))`, gap: "22px 20px", alignItems: "start", padding: "26px 4px 0" }}>
                {castAll.map((p, n) => polaroid(p, n, mobile))}
              </div>
            ) : (
              <div style={{ display: "flex", gap: mobile ? 18 : 16, alignItems: "flex-start", overflowX: "auto", scrollbarWidth: "thin", ...(mobile ? { margin: `0 -${E.space.gutter}px`, padding: `24px ${E.space.gutter + 4}px 14px` } : { padding: "24px 6px 14px" }) }}>
                {castAll.map((p, n) => polaroid(p, n, false))}
              </div>
            )}
            {castAll.length > 3 && (
              <div style={{ paddingTop: 10, display: "flex", justifyContent: "flex-end" }}>
                <UnderlineWord onClick={() => setCastExpanded((v) => !v)}>{castExpanded ? "Show fewer" : "See whole cast →"}</UnderlineWord>
              </div>
            )}
          </>
        )}
        {/* The sheet under its head — on the phone the seasons' strips run
            inline (a strip, its sheet, the next strip…); on desktop the
            season in view, with the seasons as tabs in the rail. */}
        {plotEpisodes.length > 0 && (
            <>
              <div ref={plotHeadRef} style={{ marginTop: 36, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, paddingBottom: 9, borderBottom: `1px solid ${E.color.ink}` }}>
                <span style={{ ...E.type.letterTitle22, color: E.color.ink }}>Previously, on {ref.showName}.</span>
                {(starAllowed || (ratingAllowed && ratedCount < plotEpisodes.length)) && (
                  <span style={{ ...E.type.label11, display: "inline-flex", alignItems: "center", gap: 12, flexShrink: 0, whiteSpace: "nowrap" }}>
                    {starAllowed && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: E.color.accent }}>
                        <Star size={12} color={E.color.accent} strokeWidth={2} aria-hidden="true" />
                        Star the essentials
                      </span>
                    )}
                    {/* "3 of 8 rated" until every listed episode is rated (2026-10-22). */}
                    {ratingAllowed && ratedCount < plotEpisodes.length && <span style={{ color: E.color.inkMuted }}>{ratedCount} of {plotEpisodes.length} rated</span>}
                  </span>
                )}
              </div>
              {!railHost && strips.length > 1 ? (
                strips.map((season) => {
                  const watched = plotSeasons.find((x) => x.n === season.n);
                  return (
                    <React.Fragment key={season.n}>
                      {phoneStrip(season)}
                      {watched && openPlotSeason === season.n && <div style={{ marginBottom: 28 }}>{sheetFor(watched)}</div>}
                    </React.Fragment>
                  );
                })
              ) : sheetSeason && sheetFor(sheetSeason)}
            </>
        )}
        {!railHost && trailersNode}
        {railHost && createPortal(
          <div style={{ color: E.color.ink, fontFamily: E.font.interface }}>
            {trailersNode}
            {railTabs}
          </div>,
          railHost,
        )}
        <div style={{ ...E.type.note13, color: E.color.inkMuted, marginTop: 48, maxWidth: 620 }}>
          Episode and cast data from{" "}
          <a href="https://www.tvmaze.com" target="_blank" rel="noreferrer" style={{ color: E.color.ink }}>TVMaze</a>{" "}
          (CC BY-SA) and{" "}
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" style={{ color: E.color.ink }}>TMDB</a>.
          This product uses the TMDB API but is not endorsed or certified by TMDB.
          {ref.wikipediaTitle && (
            <>{" "}Episode summaries from{" "}
              <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(ref.wikipediaTitle)}`} target="_blank" rel="noreferrer" style={{ color: E.color.ink }}>Wikipedia</a>{" "}
              (CC BY-SA).
            </>
          )}
        </div>
      </div>
    );
  }

  // Pass 3: section heads Title 22/28, sentence case, no colons; margins
  // 36/14 → 32/12; captions 13 at 0.85 (never 12 — the guide rule).
  const sectionH: React.CSSProperties = {
    fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 22 : 28, color: CREAM,
    margin: "32px 0 12px",
  };
  const small: React.CSSProperties = { fontSize: 13, color: CREAM, opacity: 0.85 };
  // Crew names read exactly like the line always did, just underlined + tappable.
  const crewLink: React.CSSProperties = {
    background: "transparent", border: "none", padding: 0, cursor: "pointer",
    color: CREAM, fontFamily: "inherit", fontSize: "inherit", fontWeight: "inherit" as const,
    textDecoration: "underline",
  };
  // Episode stills (rev 4 — Alborz 2026-09-07): the thumbnail sits directly
  // ABOVE the episode summary, back in one column with the season headers.
  const stillW = mobile ? 132 : 200, stillH = mobile ? 74 : 113;

  return (
    <div style={{ color: CREAM, fontFamily: '"Inter", sans-serif', paddingBottom: 80 }}>

      {/* "created by …" renders in the SHOW PAGE HEADER next to the show
          name (rev 3 — swaps with the "with …" members line per tab);
          attribution moved to the page bottom. */}

      {/* ── Canon status + room links (Alborz 2026-09-16): the ADD-to-canon
            pill and its "Adds it at the latest episode" caption are gone from
            the guide — adding lives on the dashboard's canon card now. What
            stays is the status pill (→ the dashboard's canon) and the open-room
            links. Cream fill / accent text: an accent pill would vanish into
            the guide's yellow page. ── */}
      {user && (canonOn || roomLinks.length > 0) && (
        <div style={{ marginBottom: 28, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          {canonOn && (
            <button
              onClick={() => navigate(mobile ? "/m/dashboard" : "/dashboard", { state: { scrollToCanon: true } })}
              title="See your canon on the dashboard"
              style={{ ...(mobile ? M.pill.M : D.pill.M), background: CREAM, color: CANON.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              <Star size={16} color={CANON.accent} fill={CANON.accent} strokeWidth={2.2} /> In your canon
            </button>
          )}
          {roomLinks.map((r) => (
            <button
              key={r.roomId}
              onClick={() => navigate(`${mobile ? "/m" : ""}/show-room/${r.roomId}`)}
              title={`Open your show room with ${r.label}`}
              style={{ ...(mobile ? M.pill.M : D.pill.M), background: CREAM, color: CANON.accent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            >
              Open your room with {r.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Previously on: watched episodes only ── */}
      {/* ── Cast: the SELECTED episode only (rev 2 — Alborz 2026-09-05):
            8 actors by default, "see whole cast" expands to THAT EPISODE's
            full credit list. Old cached blobs (no per-episode credits)
            degrade to the so-far list until the cache rebuilds. ── */}
      {visiblePeople.length > 0 && (
        <>
          {/* Pass 3: "Cast for [picker]:" → "Cast" head, then the episode
              picker on its own line as an M cream-outline pill (14/700,
              16 chevron). */}
          {/* First heading on the page — no top margin (Alborz 2026-09-16):
              the control row's own spacing is enough; 32 more read empty. */}
          <h2 style={{ ...sectionH, marginTop: 0 }}>{episodeCast ? "Cast" : "Cast so far"}</h2>
          {episodeCast && (
            <div style={{ margin: "0 0 16px" }}>
              <span style={{ position: "relative", display: "inline-block" }}>
                <select
                  value={`${selCastEp.s}-${selCastEp.e}`}
                  onChange={(ev) => {
                    const [ss, ee] = ev.target.value.split("-").map(Number);
                    setCastEpisode({ s: ss, e: ee });
                    setCastExpanded(false);
                  }}
                  aria-label="Pick an episode"
                  style={{
                    appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
                    background: "transparent", border: `2px solid ${CREAM}`, color: CREAM,
                    borderRadius: 9999, minHeight: 44, boxSizing: "border-box",
                    padding: "8px 34px 8px 16px", fontSize: 14, fontWeight: 700,
                    fontFamily: '"Inter", sans-serif', cursor: "pointer", outline: "none",
                    textAlign: "center", textAlignLast: "center",
                    maxWidth: mobile ? 240 : 340, textOverflow: "ellipsis",
                  }}
                >
                  {[...new Set(watchedEpisodes.map((ep) => ep.s))].map((sn) => (
                    <optgroup key={sn} label={`Season ${sn}`}>
                      {watchedEpisodes.filter(ep => ep.s === sn).map((ep) => (
                        <option key={`${ep.s}-${ep.e}`} value={`${ep.s}-${ep.e}`}>S{ep.s} E{ep.e} · {ep.title}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <ChevronDown size={16} color={CREAM} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              </span>
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: mobile ? 14 : 18, justifyContent: mobile ? "center" : undefined }}>
            {(castExpanded ? (episodeCast ?? visiblePeople) : foldedCast).map((p) => (
              <button
                key={p.name}
                onClick={() => openActorImdb(p)}
                title={`${p.name} on IMDb`}
                style={{ width: mobile ? 132 : 150, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "center", color: CREAM, fontFamily: "inherit" }}
              >
                {p.img ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w185${p.img}`}
                    alt=""
                    loading="lazy"
                    style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", display: "block", margin: "0 auto" }}
                  />
                ) : (
                  <div style={{ width: 72, height: 72, margin: "0 auto", borderRadius: "50%", background: "rgba(254,248,234,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: LORA, fontWeight: 700, fontSize: 24 }}>
                    {p.name[0]}
                  </div>
                )}
                <div style={{ fontWeight: 700, fontSize: 14, marginTop: 6 }}>{p.name}</div>
                {/* Pass 3: role + "since …" share ONE 13 line at 0.85
                    ("since …" only once that point is meaningfully behind
                    you — pilot-cast "since S1 E1" is noise). */}
                {(() => {
                  const since = idx(p.firstS, p.firstE) > idx(1, 1)
                    ? (p.exact ? `since S${p.firstS} E${p.firstE}` : `since season ${p.firstS}`)
                    : null;
                  if (!p.character && !since) return null;
                  return (
                    <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                      {p.character}{p.character && since ? " · " : ""}{since}
                    </div>
                  );
                })()}
              </button>
            ))}
          </div>
          {(episodeCast ?? visiblePeople).length > 8 && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              {/* Pass 3: italic text link → S ghost pill + 16 chevron. */}
              <button
                onClick={() => setCastExpanded((v) => !v)}
                aria-label={castExpanded ? "Show fewer" : "Show this episode's whole cast"}
                style={{ ...(mobile ? M.pill.S : D.pill.S), background: "transparent", border: "none", color: CREAM, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                {castExpanded ? "Show fewer" : "See whole cast"}
                {castExpanded
                  ? <ChevronUp size={16} color={CREAM} strokeWidth={2.5} />
                  : <ChevronDown size={16} color={CREAM} strokeWidth={2.5} />}
              </button>
            </div>
          )}
        </>
      )}


      <h2 style={visiblePeople.length > 0 ? sectionH : { ...sectionH, marginTop: 0 }}>So far on {ref.showName}</h2>
      {/* The essentials sticky (mobile: in-flow; desktop: first rail cell of
          the grid below) — X'd out per show, re-summoned by the dashboard's
          pick-essentials prompt. */}
      {user && canonOn && stickyVisible && mobile && (
        <div style={{ margin: "0 0 24px" }}>
          <StickyNote
            tone="cream" tilt={-3} width={190} fontSize={13} ignoreViewportGate dismissSize={20}
            onDismiss={() => { setStickyVisible(false); try { localStorage.setItem(stickyKey, "1"); } catch { /* fine */ } }}
            dismissLabel="Dismiss"
            style={{ position: "relative", zIndex: 5, display: "inline-block" }}
          >
            Mark your essential episodes with a star.
          </StickyNote>
        </div>
      )}
      {(() => {
        // Rev 6 (Alborz mock): on desktop the reference column is CENTERED,
        // leaving a real gutter on its left — the media rail ([star][still])
        // and the sticky live there as a structural grid column, each row
        // top-aligned with its episode's text. Mobile stays single-column.
        const seasonsVisible = [...ref.seasons].filter((season) => season.n <= prog.s).sort((a, b) => b.n - a.n);
        const openSet = openSeasons ?? new Set([prog.s]);
        const toggleSeason = (n: number) => setOpenSeasons((prev) => {
          const next = new Set(prev ?? [prog.s]);
          if (next.has(n)) next.delete(n); else next.add(n);
          return next;
        });
        type Season = (typeof seasonsVisible)[number];
        type Ep = Season["episodes"][number];
        const headerBtn = (season: Season, isOpen: boolean) => (
          <button
            onClick={() => toggleSeason(season.n)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Collapse" : "Expand"} season ${season.n}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: LORA, fontWeight: 700, fontSize: 22, minHeight: 44, color: CREAM, opacity: 0.95 }}
          >
            Season {season.n}
            {isOpen
              ? <ChevronUp size={16} color={CREAM} strokeWidth={2.5} />
              : <ChevronDown size={16} color={CREAM} strokeWidth={2.5} />}
          </button>
        );
        // Pass 3: 20 glyph in a 44 hit (was 15/17 with 2px padding).
        const starBtn = (ep: Ep) => (
          <button
            onClick={() => toggleEssential(ep.s, ep.e)}
            aria-pressed={essentials.has(idx(ep.s, ep.e))}
            title={essentials.has(idx(ep.s, ep.e)) ? "Un-star this essential" : "Star as an essential episode"}
            style={{ background: "transparent", border: "none", padding: 0, width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 0, flexShrink: 0 }}
          >
            <Star size={20} color={CREAM} fill={essentials.has(idx(ep.s, ep.e)) ? CREAM : "none"} strokeWidth={2} />
          </button>
        );
        const stillBtn = (ep: Ep) => (
          <button
            onClick={() => setStillOpen(ep.still!)}
            aria-label={`Enlarge the episode ${ep.e} still`}
            style={{ padding: 0, border: "none", background: "transparent", cursor: "zoom-in", lineHeight: 0, display: "block" }}
          >
            <img src={ep.still!} alt="" loading="lazy" style={{ width: stillW, height: stillH, objectFit: "cover", borderRadius: 12, display: "block" }} />
          </button>
        );
        // Pass 3: title 15/600 (the air date leaves it); the 13-at-0.85
        // credits line leads with the air date; summary Body 15/1.6.
        const epText = (ep: Ep) => (
          <>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              Episode {ep.e} · {ep.title}
            </div>
            {(ep.airDate || ep.writers.length > 0 || ep.directors.length > 0 || ep.dp.length > 0) && (
              <div style={{ ...small, marginTop: 2 }}>
                {ep.airDate && <>{ep.airDate}{(ep.writers.length > 0 || ep.directors.length > 0 || ep.dp.length > 0) && " · "}</>}
                {[
                  { label: "written by", credits: ep.writers.map(toCredit) },
                  { label: "directed by", credits: ep.directors.map(toCredit) },
                  { label: "dp", credits: ep.dp.map(toCredit) },
                ].filter((g) => g.credits.length > 0).map((g, gi) => (
                  <React.Fragment key={g.label}>
                    {gi > 0 && " · "}
                    {g.label}{" "}
                    {g.credits.map((c, ci) => (
                      <React.Fragment key={c.name}>
                        {ci > 0 && ", "}
                        <button onClick={() => openActorImdb(c)} title={`${c.name} on IMDb`} style={crewLink}>{c.name}</button>
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            )}
            {mobile && ep.still && (
              <div style={{ marginTop: 8 }}>{stillBtn(ep)}</div>
            )}
            {ep.summary && (
              <div style={{ fontSize: 15, lineHeight: 1.6, marginTop: mobile ? 8 : 4, opacity: 0.95, maxWidth: 620 }}>
                {ep.summary}
              </div>
            )}
          </>
        );
        if (mobile) {
          return seasonsVisible.map((season) => {
            const watched = season.episodes.filter((ep) => idx(ep.s, ep.e) <= vIdx).reverse();
            const isOpen = openSet.has(season.n);
            return (
              <div key={season.n} style={{ marginBottom: isOpen ? 28 : 14 }}>
                <div style={{ marginBottom: isOpen ? 10 : 0 }}>{headerBtn(season, isOpen)}</div>
                {/* Pass 3: the essentials star moves out of the title into
                    a left gutter (44 hit, top-aligned with the title). */}
                {isOpen && watched.map((ep) => (
                  <div key={ep.e} style={{ marginBottom: 20, display: "flex", gap: 4 }}>
                    {user && canonOn && <div style={{ flexShrink: 0, marginLeft: -8, marginTop: -10 }}>{starBtn(ep)}</div>}
                    <div style={{ minWidth: 0, flex: 1 }}>{epText(ep)}</div>
                  </div>
                ))}
              </div>
            );
          });
        }
        // Rail's left edge sits AT the entries-column position (Alborz
        // 2026-09-08) — the synopsis column shifts right instead of the rail
        // hanging into the page margin. The grid is WIDER than the host
        // column (940 = 240 rail + 24 gap + 676 text) so long synopses don't
        // run narrow-and-tall; the hidden map pane absorbs the spill. The
        // sticky FLOATS in the margin left of the rail — fully out of flow,
        // so neither dismissing it nor collapsing seasons ever moves the
        // guide.
        return (
          <div style={{ position: "relative", width: 940, maxWidth: "calc(100vw - 48px)" }}>
          {user && canonOn && stickyVisible && (
            <div style={{ position: "absolute", top: -2, left: -186, zIndex: 5 }}>
              <StickyNote
                tone="cream" tilt={-3} width={170} fontSize={13} ignoreViewportGate dismissSize={20}
                onDismiss={() => { setStickyVisible(false); try { localStorage.setItem(stickyKey, "1"); } catch { /* fine */ } }}
                dismissLabel="Dismiss"
                style={{ position: "relative", display: "inline-block" }}
              >
                Mark your essential episodes with a star.
              </StickyNote>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr)", columnGap: 24, alignItems: "start" }}>
            {seasonsVisible.map((season, si) => {
              const watched = season.episodes.filter((ep) => idx(ep.s, ep.e) <= vIdx).reverse();
              const isOpen = openSet.has(season.n);
              return (
                <React.Fragment key={season.n}>
                  <div />
                  <div style={{ marginBottom: isOpen ? 12 : 14 }}>{headerBtn(season, isOpen)}</div>
                  {isOpen && watched.map((ep) => (
                    <React.Fragment key={`${season.n}-${ep.e}`}>
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-start", gap: 8, marginBottom: 20 }}>
                        {user && canonOn && <div style={{ marginTop: -10 }}>{starBtn(ep)}</div>}
                        {ep.still && stillBtn(ep)}
                      </div>
                      <div style={{ minWidth: 0, marginBottom: 20 }}>{epText(ep)}</div>
                    </React.Fragment>
                  ))}
                </React.Fragment>
              );
            })}
          </div>
          </div>
        );
      })()}
      {/* Unwatched episodes/seasons render NOTHING at all (Alborz 2026-09-05
          — the dial's dropdown already tells the viewer how much is left). */}

      {/* ── Trailers: launch + unlocked season trailers + ONE locked tease ── */}
      <h2 style={sectionH}>Trailers</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 }}>
        {ref.launchTrailerKey && <RefTrailer label="the launch trailer" trailerKey={ref.launchTrailerKey} />}
        {ref.seasons.filter((season) => season.n >= 2 && season.trailerKey).map((season) => {
          const prev = ref.seasons.find((x) => x.n === season.n - 1);
          const prevLast = prev?.episodes[prev.episodes.length - 1];
          const unlocked = !!prevLast && vIdx >= idx(prevLast.s, prevLast.e);
          if (unlocked) return <RefTrailer key={season.n} label={`season ${season.n}`} trailerKey={season.trailerKey!} />;
          // Only the NEXT locked one is teased; deeper seasons stay silent.
          if (season.n === prog.s + 1) {
            return (
              <div key={season.n} style={{ ...small, fontStyle: "italic" }}>
                the season {season.n} trailer unlocks when you finish season {season.n - 1}
              </div>
            );
          }
          return null;
        })}
      </div>

      {/* ── Attribution — page footer (rev 3; was up top) ── */}
      <div style={{ ...small, marginTop: 48, lineHeight: 1.5, maxWidth: 620 }}>
        Episode and cast data from{" "}
        <a href="https://www.tvmaze.com" target="_blank" rel="noreferrer" style={{ color: CREAM }}>TVMaze</a>{" "}
        (CC BY-SA) and{" "}
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" style={{ color: CREAM }}>TMDB</a>.
        This product uses the TMDB API but is not endorsed or certified by TMDB.
        {ref.wikipediaTitle && (
          <>{" "}Episode summaries from{" "}
            <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(ref.wikipediaTitle)}`} target="_blank" rel="noreferrer" style={{ color: CREAM }}>Wikipedia</a>{" "}
            (CC BY-SA).
          </>
        )}
      </div>

      {/* ── Still lightbox: dim + a larger render; clicking outside closes ── */}
      {stillOpen && (
        <div
          onClick={() => setStillOpen(null)}
          role="button"
          aria-label="Close"
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(26,58,74,0.25)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", cursor: "zoom-out" }}
        >
          <img
            src={stillLarge(stillOpen)}
            alt=""
            onClick={(e) => e.stopPropagation()}
            onError={(e) => { const img = e.currentTarget; if (!img.src.endsWith(stillOpen)) img.src = stillOpen; }}
            style={{ maxWidth: "min(860px, 92vw)", maxHeight: "80vh", borderRadius: 14, cursor: "default", boxShadow: "0 12px 36px rgba(0,0,0,0.35)" }}
          />
        </div>
      )}
    </div>
  );
}

// The stored still is deliberately small (list render) — the lightbox asks
// its source for the bigger size (TVMaze original / TMDB w780); a 404 falls
// back to the small one via the img's onError.
function stillLarge(url: string): string {
  if (url.includes("/medium_landscape/")) return url.replace("/medium_landscape/", "/original_untouched/");
  if (url.includes("/t/p/w300")) return url.replace("/t/p/w300", "/t/p/w780");
  return url;
}


// Inline trailer facade (TrailerCard's thumbnail→iframe pattern, but for a
// KNOWN key from the reference blob).
function RefTrailer({ label, trailerKey, editorial = false }: { label: string; trailerKey: string; editorial?: boolean }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: editorial ? E.color.ink : CANON.cream, marginBottom: 6 }}>{label}</div>
      <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 14, overflow: "hidden", background: "rgba(0,0,0,0.25)" }}>
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&rel=0`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title="Trailer"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
          />
        ) : (
          <button
            onClick={() => setPlaying(true)}
            aria-label="Play trailer"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", padding: 0, cursor: "pointer", background: "transparent" }}
          >
            <img
              src={`https://i.ytimg.com/vi/${trailerKey}/hqdefault.jpg`}
              loading="lazy"
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
            <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 56, height: 56, borderRadius: "50%", background: "rgba(26,58,74,0.75)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ width: 0, height: 0, borderTop: "10px solid transparent", borderBottom: "10px solid transparent", borderLeft: `16px solid ${CANON.cream}`, marginLeft: 4 }} />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
