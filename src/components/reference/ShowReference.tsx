// ShowReference — the spoiler-gated reference tab's body (CP1, 2026-09-05).
// Shared by the desktop + mobile show pages (idiom prop sizes it). Renders a
// show's cached reference index gated to the VIEWER'S OWN progress: watched
// episodes in full, everything past the dial as folded shape-only cells (the
// season map's disclosure rule — shape visible, contents not). Copy locked
// by Alborz 2026-09-05. Never rendered below S1E1 (the tab is hidden until
// the dial reaches it — "no 0-state reference page").

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, Star } from "lucide-react";
import StickyNote from "../StickyNote";
import { CANON } from "../../styles/canon";
import LoadingDots from "../LoadingDots";
import { ensureShowReference, stampReferenceLookup, toCredit, type ShowReferenceData } from "../../lib/reference";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabaseClient";
import { setCanonPin, setEssentialEps, upsertRewatchStatus, fetchFriendGroupsForUser, fetchPeopleGroupsForUser, fetchPeopleGroupMembers, fetchContactNames } from "../../lib/db";
import { groupDisplayName, joinNames } from "../../lib/groupNames";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const CREAM = CANON.cream;
const idx = (s: number, e: number) => s * 10000 + e;

export default function ShowReference({
  showId, viewerProgress, mobile = false, nudgeEssentials = false, showRoomLinks = false,
}: {
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
  const [canonBusy, setCanonBusy] = useState(false);
  // The canon is capped at FOUR shows (Alborz 2026-09-07) — the add pill
  // gives way to a note once the cap is reached elsewhere.
  const [canonCount, setCanonCount] = useState<number | null>(null);
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
  // Canon rule (Alborz 2026-09-07): adding a show to your canon SETS YOUR
  // PROGRESS to the latest catalog episode — canon means you've seen it all
  // (as of now). This local override reflects the jump immediately; the
  // host page's own copy refreshes on its next load.
  const [progressOverride, setProgressOverride] = useState<{ s: number; e: number } | null>(null);

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
    supabase
      .from("progress")
      .select("show_id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("canon_pin", true)
      .then(({ count }) => { if (!cancelled) setCanonCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [showId, user?.id]);

  async function addToCanon() {
    if (!user || canonBusy) return;
    setCanonBusy(true);
    try {
      await setCanonPin(user.id, showId, true);
      // Canon ⇒ progress at the latest episode (never lowers — only jumps
      // forward). The reference ungates fully right away via the override.
      const lastSeason = ref?.seasons[ref.seasons.length - 1];
      const lastEp = lastSeason?.episodes[lastSeason.episodes.length - 1];
      if (lastEp && idx(lastEp.s, lastEp.e) > vIdx) {
        await upsertRewatchStatus(user.id, showId, { s: lastEp.s, e: lastEp.e, highestS: lastEp.s, highestE: lastEp.e });
        setProgressOverride({ s: lastEp.s, e: lastEp.e });
      }
      setCanonOn(true);
    } catch (e) { console.error("[reference] add-to-canon failed", e); }
    finally { setCanonBusy(false); }
  }
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

  const visiblePeople = useMemo(
    () => (ref?.people ?? []).filter((p) => idx(p.firstS, p.firstE) <= vIdx),
    [ref, vIdx],
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
      <div style={{ color: CREAM, fontSize: 14, lineHeight: 1.5, maxWidth: 460 }}>
        The show guide couldn&rsquo;t load just now. Try again in a minute.
      </div>
    );
  }
  if (!ref) {
    return (
      <div style={{ color: CREAM }}>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14 }}>
          building this show&rsquo;s guide<LoadingDots />
        </span>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6, fontStyle: "italic" }}>
          (first visit only — takes a few seconds)
        </div>
      </div>
    );
  }

  const sectionH: React.CSSProperties = {
    fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 22 : 26, color: CREAM,
    margin: "36px 0 14px",
  };
  const small: React.CSSProperties = { fontSize: 12, color: CREAM, opacity: 0.85 };
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

      {/* ── Canon controls (rev 5 — Alborz 2026-09-07): the reference page
            only ADDS; the blurb, edit and remove all live on the dashboard's
            canon shelf now. ── */}
      {user && (canonOn !== null || roomLinks.length > 0) && (
        <div style={{ marginBottom: 32, display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 10 }}>
          {canonOn === null ? null : !canonOn ? (
            // Canon full → no pill, no note (Alborz 2026-09-08); the room
            // pills below still render.
            (canonCount ?? 0) >= 4 ? null : (
              <>
                <button
                  onClick={addToCanon}
                  disabled={canonBusy}
                  style={{ background: "transparent", border: `2px solid ${CREAM}`, color: CREAM, borderRadius: 65, padding: "9px 22px", fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                >
                  add to your canon
                </button>
                <div style={{ fontStyle: "italic", fontSize: 12, opacity: 0.85, marginTop: 6 }}>
                  (also sets your progress to the latest episode)
                </div>
              </>
            )
          ) : (
            // No star here (stars = essentials); cream pill in Accent text.
            // Tap → the dashboard, scrolled to the canon section.
            <button
              onClick={() => navigate(mobile ? "/m/dashboard" : "/dashboard", { state: { scrollToCanon: true } })}
              title="See your canon on the dashboard"
              style={{ background: CREAM, border: "none", color: CANON.accent, borderRadius: 65, padding: "9px 22px", fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, cursor: "pointer" }}
            >
              in your canon
            </button>
          )}
          {/* Open show rooms for this show (dashboard-route only) — the
              "in your canon" pill grammar; one per friend-group room. */}
          {roomLinks.map((r) => (
            <button
              key={r.roomId}
              onClick={() => navigate(`${mobile ? "/m" : ""}/show-room/${r.roomId}`)}
              title={`Open your show room with ${r.label}`}
              style={{ background: CREAM, border: "none", color: CANON.accent, borderRadius: 65, padding: "9px 22px", fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, cursor: "pointer" }}
            >
              open your room with {r.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Previously on: watched episodes only ── */}
      <h2 style={sectionH}>Previously on {ref.showName}:</h2>
      {/* The essentials sticky (mobile: in-flow; desktop: first rail cell of
          the grid below) — X'd out per show, re-summoned by the dashboard's
          pick-essentials prompt. */}
      {user && canonOn && stickyVisible && mobile && (
        <div style={{ margin: "0 0 24px" }}>
          <StickyNote
            tone="cream" tilt={-3} width={190} fontSize={13} ignoreViewportGate
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
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 16 : 18, color: CREAM, opacity: 0.95 }}
          >
            Season {season.n}
            {isOpen
              ? <ChevronUp size={16} color={CREAM} strokeWidth={2.5} />
              : <ChevronDown size={16} color={CREAM} strokeWidth={2.5} />}
          </button>
        );
        const starBtn = (ep: Ep, size: number, inline: boolean) => (
          <button
            onClick={() => toggleEssential(ep.s, ep.e)}
            aria-pressed={essentials.has(idx(ep.s, ep.e))}
            title={essentials.has(idx(ep.s, ep.e)) ? "Un-star this essential" : "Star as an essential episode"}
            style={{ background: "transparent", border: "none", padding: 2, cursor: "pointer", lineHeight: 0, flexShrink: 0, ...(inline ? { marginRight: 6, verticalAlign: "middle" } : {}) }}
          >
            <Star size={size} color={CREAM} fill={essentials.has(idx(ep.s, ep.e)) ? CREAM : "none"} strokeWidth={2} />
          </button>
        );
        const stillBtn = (ep: Ep) => (
          <button
            onClick={() => setStillOpen(ep.still!)}
            aria-label={`Enlarge the episode ${ep.e} still`}
            style={{ padding: 0, border: "none", background: "transparent", cursor: "zoom-in", lineHeight: 0, display: "block" }}
          >
            <img src={ep.still!} alt="" loading="lazy" style={{ width: stillW, height: stillH, objectFit: "cover", borderRadius: 10, display: "block" }} />
          </button>
        );
        const epText = (ep: Ep) => (
          <>
            <div style={{ fontWeight: 700, fontSize: mobile ? 14 : 15 }}>
              {user && canonOn && mobile && starBtn(ep, 15, true)}
              Episode {ep.e} · {ep.title}
              {ep.airDate && <span style={{ fontWeight: 500, opacity: 0.7 }}>  ·  {ep.airDate}</span>}
            </div>
            {(ep.writers.length > 0 || ep.directors.length > 0 || ep.dp.length > 0) && (
              <div style={{ ...small, marginTop: 2 }}>
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
              <div style={{ fontSize: mobile ? 13 : 14, lineHeight: 1.55, marginTop: mobile ? 8 : 4, opacity: 0.95, maxWidth: 620 }}>
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
                {isOpen && watched.map((ep) => (
                  <div key={ep.e} style={{ marginBottom: 20 }}>{epText(ep)}</div>
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
                tone="cream" tilt={-3} width={170} fontSize={13} ignoreViewportGate
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
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, paddingTop: 2, marginBottom: 20 }}>
                        {user && canonOn && starBtn(ep, 17, false)}
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

      {/* ── Cast: the SELECTED episode only (rev 2 — Alborz 2026-09-05):
            8 actors by default, "see whole cast" expands to THAT EPISODE's
            full credit list. Old cached blobs (no per-episode credits)
            degrade to the so-far list until the cache rebuilds. ── */}
      {visiblePeople.length > 0 && (
        <>
          {/* "Cast for (picker):" — the picker mirrors the yellow modal's
              progress pill (cream text + outline, yellow fill, overlay
              chevron; OneSelectProgress's non-plain grammar). */}
          <h2 style={{ ...sectionH, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            {episodeCast ? (
              <>
                Cast for
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
                      borderRadius: 9999, height: 40, boxSizing: "border-box",
                      padding: "8px 28px 8px 14px", fontSize: 12, fontWeight: 700,
                      fontFamily: '"Inter", sans-serif', cursor: "pointer", outline: "none",
                      textAlign: "center", textAlignLast: "center",
                      maxWidth: mobile ? 210 : 320, textOverflow: "ellipsis",
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
                  <ChevronDown size={14} color={CREAM} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                </span>
                :
              </>
            ) : "Cast so far:"}
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: mobile ? 14 : 18 }}>
            {(castExpanded ? (episodeCast ?? visiblePeople) : foldedCast).map((p) => (
              <button
                key={p.name}
                onClick={() => openActorImdb(p)}
                title={`${p.name} on IMDb`}
                style={{ width: mobile ? 132 : 150, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: CREAM, fontFamily: "inherit" }}
              >
                {p.img ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w185${p.img}`}
                    alt=""
                    loading="lazy"
                    style={{ width: mobile ? 64 : 72, height: mobile ? 64 : 72, borderRadius: "50%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ width: mobile ? 64 : 72, height: mobile ? 64 : 72, borderRadius: "50%", background: "rgba(254,248,234,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: LORA, fontWeight: 700, fontSize: 24 }}>
                    {p.name[0]}
                  </div>
                )}
                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>{p.name}</div>
                {p.character && <div style={{ fontSize: 12, opacity: 0.9 }}>{p.character}</div>}
                {/* "since …" only once that point is meaningfully behind you
                    (pilot-cast "since S1 E1" is noise). */}
                {idx(p.firstS, p.firstE) > idx(1, 1) && (
                  <div style={{ ...small, marginTop: 2 }}>
                    {p.exact ? `since S${p.firstS} E${p.firstE}` : `since season ${p.firstS}`}
                  </div>
                )}
              </button>
            ))}
          </div>
          {(episodeCast ?? visiblePeople).length > 8 && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button
                onClick={() => setCastExpanded((v) => !v)}
                aria-label={castExpanded ? "Show fewer" : "Show this episode's whole cast"}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", padding: 4, color: CREAM, fontFamily: '"Inter", sans-serif', fontStyle: "italic", fontWeight: 400, fontSize: 13 }}
              >
                {castExpanded ? "show fewer" : "see whole cast"}
                {castExpanded
                  ? <ChevronUp size={20} color={CREAM} strokeWidth={2.5} />
                  : <ChevronDown size={20} color={CREAM} strokeWidth={2.5} />}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Trailers: launch + unlocked season trailers + ONE locked tease ── */}
      <h2 style={sectionH}>Trailers:</h2>
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
function RefTrailer({ label, trailerKey }: { label: string; trailerKey: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: CANON.cream, marginBottom: 6 }}>{label}</div>
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
