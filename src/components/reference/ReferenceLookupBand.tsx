// ReferenceLookupBand — the dashboard's personal lookup band (spoiler-gated
// reference CP2, 2026-09-05; copy locked by Alborz). Sits BELOW the group
// world on both dashboards: heading + sub, the standard show search, the
// cross-device "You've looked up:" recent row, and the browse rows asking
// the DASHBOARD's question — "How far in are you?" with the progress picker
// on a yellow card ("look it up" disabled at zero: no 0-state reference).
// A show looked up here is NEVER a proposal anywhere; it just gets/updates
// the viewer's own progress row and opens the standalone reference page.
// Self-sufficient: fetches its own catalog/progress (module caches make the
// dashboard's own fetches free), so both hosts mount it identically.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { CANON } from "../../styles/canon";
import { useAuth } from "../../lib/auth";
import {
  fetchShows, fetchProgress, createShow, type Show,
} from "../../lib/db";
import type { ProgressEntry } from "../../types";
import { tvmazeSearch, tvmazeEpisodes, networkLabel, slugify, fetchTvmazePoster, type TVmazeShow } from "../../lib/tvmaze";
import { ensureCatalogShow } from "../../lib/browseCatalog";
import type { BrowseShow } from "../../lib/db";
import { ensureShowReference, stampReferenceLookup, hideFromWatchingShelf, markWantToWatch, clearWantToWatch, type ShowReferenceData } from "../../lib/reference";
import { upsertRewatchStatus, setCanonPin, setShelfBlurb } from "../../lib/db";
import BrowseRows from "../BrowseRows";
import MobileBrowseRows from "../../mobile/MobileBrowseRows";
import OneSelectProgress from "../OneSelectProgress";
import TrailerCard from "../TrailerCard";
import LoadingDots from "../LoadingDots";
import SidebarLogo from "../SidebarLogo";
import { overlay, searchCard, searchInput, modalClose, yellowCard, yellowTitle, startBtn, searchPill } from "../dashboardChrome";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const CREAM = CANON.cream;
const EMPTY_EXCLUDE = new Set<number>();

// The group opt-in modal's two-layer scrollable overlay (mirrors DashboardPage's
// file-local trailerScrollOverlay/trailerCenterColumn): a fixed scrollable
// backdrop + an inner column centering [card + 8px gap + trailer] as a pair,
// scrolling on short viewports. Trailer miss → the card centers alone.
const cardScrollOverlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(26,58,74,0.25)", zIndex: 1100, overflowY: "auto",
};
const cardCenterColumn: React.CSSProperties = {
  minHeight: "100%", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", gap: 8,
  padding: "24px 16px", boxSizing: "border-box",
};

export default function ReferenceLookupBand({ mobile = false }: { mobile?: boolean }) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const pathPrefix = mobile ? "/m/show-room/private" : "/show-room/private";

  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  // De-clutter X per SHOW (CP1 2026-09-07): hides it from the watching
  // shelf optimistically + cross-device. Progress untouched; a fresh lookup
  // brings it back.
  function hideShow(showId: string) {
    setProgress((prev) => {
      const entry = prev[showId];
      return entry ? { ...prev, [showId]: { ...entry, shelfHiddenAt: Date.now() } } : prev;
    });
    if (user) hideFromWatchingShelf(user.id, showId); // fire-and-forget
  }

  // At the show's last catalog episode = finished (Alborz 2026-09-07: airing
  // status doesn't matter — caught-up-and-waiting counts as finished; a new
  // episode landing in the catalog moves the show back to Watching on its own).
  const atLatest = (show: Show) => {
    const p = progress[show.id];
    const seasons = (show as any).seasons as number[] | undefined;
    if (!p || !seasons?.length) return false;
    const ls = seasons.length, le = seasons[ls - 1] ?? 1;
    return p.s > ls || (p.s === ls && p.e >= le);
  };

  // "You're watching:" (CP1 — replaces the You've-looked-up row): every show
  // with the viewer's own progress at S1E1+ and BELOW the latest episode,
  // minus shelf-hidden ones, most recent activity first.
  const watching = useMemo(() => {
    return shows
      .filter((show) => {
        const p = progress[show.id];
        return p && (p.s > 1 || (p.s === 1 && p.e >= 1)) && !p.shelfHiddenAt && !atLatest(show);
      })
      .sort((a, b) => {
        const act = (id: string) => Math.max(progress[id]?.lastLookedUpAt ?? 0, progress[id]?.progressUpdatedAt ?? 0);
        return act(b.id) - act(a.id);
      });
  }, [shows, progress]);

  // "You want to watch:" (CP2) — wanted_at stamped + still below S1E1
  // (starting the show migrates it to Watching automatically), newest first.
  const wantList = useMemo(() => {
    return shows
      .filter((show) => {
        const p = progress[show.id];
        return p?.wantedAt && !(p.s > 1 || (p.s === 1 && p.e >= 1));
      })
      .sort((a, b) => (progress[b.id]?.wantedAt ?? 0) - (progress[a.id]?.wantedAt ?? 0));
  }, [shows, progress]);

  const [wantBusy, setWantBusy] = useState(false);
  async function wantIt() {
    if (!user || !cardShow || wantBusy) return;
    setWantBusy(true);
    try {
      await markWantToWatch(user.id, cardShow.id);
      setProgress((prev) => ({ ...prev, [cardShow.id]: { ...(prev[cardShow.id] ?? { s: 0, e: 0 }), wantedAt: Date.now() } }));
      setCardShow(null);
      setCardPending(null);
    } catch (e) { console.error("[ref-band] want-to-watch failed", e); }
    finally { setWantBusy(false); }
  }
  function unwantShow(showId: string) {
    setProgress((prev) => {
      const entry = prev[showId];
      return entry ? { ...prev, [showId]: { ...entry, wantedAt: undefined } } : prev;
    });
    if (user) clearWantToWatch(user.id, showId); // fire-and-forget
  }

  // "Your canon:" (CP3) — canon-pinned shows (curated on the reference page;
  // this shelf displays). Old-profile ordering honored, then alphabetical.
  const canonList = useMemo(() => {
    return shows
      .filter((show) => progress[show.id]?.canonPin)
      .sort((a, b) => {
        const pa = progress[a.id]?.shelfPosition ?? Infinity;
        const pb = progress[b.id]?.shelfPosition ?? Infinity;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
      });
  }, [shows, progress]);
  function removeCanon(showId: string) {
    setProgress((prev) => {
      const entry = prev[showId];
      return entry ? { ...prev, [showId]: { ...entry, canonPin: false } } : prev;
    });
    // Pin off only — the blurb stays stored (re-adding restores it).
    if (user) setCanonPin(user.id, showId, false).catch(() => {});
  }

  // "You've finished:" (2026-09-07) — at the latest catalog episode, not yet
  // canon (canon graduates a show OFF this shelf), not hidden; recent first.
  const finishedList = useMemo(() => {
    return shows
      .filter((show) => {
        const p = progress[show.id];
        return p && (p.s > 1 || (p.s === 1 && p.e >= 1)) && !p.shelfHiddenAt && !p.canonPin && atLatest(show);
      })
      .sort((a, b) => (progress[b.id]?.progressUpdatedAt ?? 0) - (progress[a.id]?.progressUpdatedAt ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shows, progress]);

  // The canon card modal (2026-09-07) — canon is curated from the dashboard
  // too: add (from the canon +/search or a finished tile's graduate line) or
  // edit an existing card's blurb. ADDING also sets progress to the show's
  // latest catalog episode (canon means you've seen it all — the card says
  // so); editing never touches progress.
  const [canonCard, setCanonCard] = useState<{ show: Show | null; name: string; adding: boolean } | null>(null);
  const [canonDraft, setCanonDraft] = useState("");
  const [canonBusy, setCanonBusy] = useState(false);
  function openCanonCard(show: Show) {
    const entry = progress[show.id];
    setCanonDraft(entry?.canonTake ?? "");
    setCanonCard({ show, name: show.name, adding: !entry?.canonPin });
    setSearchOpen(false);
    setQuery("");
    setTvResults([]);
  }
  async function confirmCanon() {
    if (!user || !canonCard?.show || canonBusy) return;
    const show = canonCard.show;
    setCanonBusy(true);
    try {
      let jumped: { s: number; e: number } | null = null;
      if (canonCard.adding) {
        const seasons = (show as any).seasons as number[] | undefined;
        if (seasons?.length) {
          const ls = seasons.length, le = seasons[ls - 1] ?? 1;
          const p = progress[show.id];
          const cur = p ? p.s * 10000 + p.e : 0;
          if (ls * 10000 + le > cur) {
            jumped = { s: ls, e: le };
            await upsertRewatchStatus(user.id, show.id, { s: ls, e: le, highestS: ls, highestE: le });
          }
        }
        await setCanonPin(user.id, show.id, true);
      }
      await setShelfBlurb(user.id, show.id, "canon_take", canonDraft);
      setProgress((prev) => ({
        ...prev,
        [show.id]: {
          ...(prev[show.id] ?? { s: 0, e: 0 }),
          ...(jumped ? { s: jumped.s, e: jumped.e, highestS: jumped.s, highestE: jumped.e } : {}),
          canonPin: true,
          canonTake: canonDraft.trim() || undefined,
        },
      }));
      setCanonCard(null);
    } catch (e) { console.error("[ref-band] canon card failed", e); }
    finally { setCanonBusy(false); }
  }

  // The shareable "{Name}'s TV Canon" card (CP4) — opens from a canon
  // card's essentials line; screenshot-friendly. Episode titles resolve
  // from the module-cached reference blob.
  const [shareShow, setShareShow] = useState<Show | null>(null);
  const [shareRef, setShareRef] = useState<ShowReferenceData | null>(null);
  function openShare(show: Show) {
    setShareShow(show);
    setShareRef(null);
    ensureShowReference(show.id).then((r) => setShareRef(r)).catch(() => {});
  }
  const [posters, setPosters] = useState<Record<string, string | null>>({});

  // Search lives in an OVERLAY card (rev 2026-09-05 — the group room's
  // search grammar; inline results were pushing the page around). "canon"
  // mode (opened from the canon shelf's +) routes picks to the canon card
  // instead of the how-far card.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<"lookup" | "canon">("lookup");
  const [query, setQuery] = useState("");
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [busyAdd, setBusyAdd] = useState(false);
  const tvDebounceRef = useRef<number | null>(null);

  // The first-tap card ("How far in are you?"). cardPending paints the card
  // INSTANTLY on a pick (name + trailer) while the catalog show resolves —
  // the picker area shows dots until it lands (rev 2026-09-05 perf).
  const [cardPending, setCardPending] = useState<{ name: string; tvmazeId: string | null } | null>(null);
  const [cardShow, setCardShow] = useState<Show | null>(null);
  const [picked, setPicked] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [confirmBusy, setConfirmBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchShows().then((rows) => { if (!cancelled) setShows(rows); }).catch(() => {});
    fetchProgress(user.id).then((p) => { if (!cancelled) setProgress(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  // Posters for the watching shelf (TVMaze medium, module-cached).
  useEffect(() => {
    let cancelled = false;
    for (const show of [...watching, ...wantList, ...canonList, ...finishedList]) {
      if (!show.tvmazeId || posters[show.id] !== undefined) continue;
      fetchTvmazePoster(show.tvmazeId).then((url) => {
        if (!cancelled) setPosters((prev) => ({ ...prev, [show.id]: url }));
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, wantList, canonList, finishedList]);

  // Search — the established catalog + debounced-TVMaze pattern.
  const catalogMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shows.filter((s) => !s.isHidden && s.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, shows]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setTvResults([]); return; }
    if (tvDebounceRef.current) window.clearTimeout(tvDebounceRef.current);
    let cancelled = false;
    tvDebounceRef.current = window.setTimeout(async () => {
      try {
        const r = await tvmazeSearch(q);
        if (!cancelled) setTvResults(r);
      } catch { if (!cancelled) setTvResults([]); }
    }, 320);
    return () => { cancelled = true; if (tvDebounceRef.current) window.clearTimeout(tvDebounceRef.current); };
  }, [query]);

  const tvToAdd = useMemo(() => {
    const known = new Set(shows.map((s) => s.id));
    const seen = new Set<string>();
    const out: { tv: TVmazeShow; id: string }[] = [];
    for (const tv of tvResults) {
      const id = slugify(tv.name);
      if (known.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ tv, id });
      if (out.length >= 6) break;
    }
    return out;
  }, [tvResults, shows]);

  function openCard(show: Show) {
    const existing = progress[show.id];
    setPicked(existing ? { s: existing.s, e: existing.e } : { s: 0, e: 0 });
    setCardShow(show);
    setCardPending(null);
    setSearchOpen(false);
    setQuery("");
    setTvResults([]);
    // Warm the reference blob NOW — by "look it up" it's already in the
    // module cache, so the reference tab paints without its own wait.
    ensureShowReference(show.id).catch(() => { /* the tab retries */ });
  }

  // A pick paints the card immediately; the catalog resolve fills it in.
  function openPending(name: string, tvmazeId: string | null) {
    setPicked({ s: 0, e: 0 });
    setCardShow(null);
    setCardPending({ name, tvmazeId });
    setSearchOpen(false);
    setQuery("");
    setTvResults([]);
  }

  async function pickTvShow(tv: TVmazeShow) {
    if (busyAdd) return;
    setBusyAdd(true);
    if (searchMode === "canon") {
      // Canon mode: the canon card paints pending, then fills in.
      setCanonDraft("");
      setCanonCard({ show: null, name: tv.name, adding: true });
      setSearchOpen(false); setQuery(""); setTvResults([]);
    } else {
      openPending(tv.name, String(tv.id));
    }
    try {
      const seasons = await tvmazeEpisodes(tv.id);
      const created = await createShow({ id: slugify(tv.name), name: tv.name, seasons, tvmazeId: String(tv.id), status: tv.status });
      setShows((prev) => (prev.some((s) => s.id === created.id) ? prev : [...prev, created]));
      if (searchMode === "canon") setCanonCard({ show: created, name: created.name, adding: true });
      else openCard(created);
    } catch (e) { console.error("[ref-band] add show failed", e); setCardPending(null); setCanonCard(null); }
    finally { setBusyAdd(false); }
  }

  async function pickBrowseShow(b: BrowseShow) {
    if (busyAdd) return;
    setBusyAdd(true);
    openPending(b.name, String(b.tvmazeId));
    try {
      const show = await ensureCatalogShow(shows, b);
      setShows((prev) => (prev.some((s) => s.id === show.id) ? prev : [...prev, show]));
      openCard(show);
    } catch (e) { console.error("[ref-band] browse pick failed", e); setCardPending(null); }
    finally { setBusyAdd(false); }
  }

  const pickedReady = picked.s >= 1 && picked.e >= 1;

  async function lookItUp() {
    if (!user || !cardShow || !pickedReady || confirmBusy) return;
    setConfirmBusy(true);
    try {
      // Progress only — never a proposal. Highest never lowers for a show
      // that already has a row (the reading ceiling stays).
      const existing = progress[cardShow.id];
      const exHS = existing?.highestS ?? 0;
      const exHE = existing?.highestE ?? 0;
      const keepCeiling = exHS > picked.s || (exHS === picked.s && exHE >= picked.e);
      const entry: ProgressEntry = {
        s: picked.s, e: picked.e,
        highestS: keepCeiling ? exHS : picked.s,
        highestE: keepCeiling ? exHE : picked.e,
      };
      await upsertRewatchStatus(user.id, cardShow.id, entry);
      stampReferenceLookup(user.id, cardShow.id); // fire-and-forget
      navigate(`${pathPrefix}/${cardShow.id}`, { state: { openReference: true } });
    } catch (e) {
      console.error("[ref-band] look-it-up failed", e);
      setConfirmBusy(false);
    }
  }

  if (!user) return null;

  // Result rows inside the cream search overlay — Personal-green text
  // (the group-room search-card result grammar).
  const resultBtn: React.CSSProperties = {
    display: "block", width: "100%", textAlign: "left", border: "none", cursor: "pointer",
    background: "transparent", color: CANON.personal, fontWeight: 700, fontSize: 14,
    padding: "10px 12px", borderRadius: 10,
  };

  const cardTitle = cardShow?.name ?? cardPending?.name ?? "";
  const cardTvmazeId = cardShow?.tvmazeId ?? cardPending?.tvmazeId ?? null;

  return (
    // The band lives in its own Accent-yellow zone (the hosts paint it);
    // desktop width matches the browse window (1178) — heading/sub/search
    // self-cap narrower and center inside.
    <div style={{ width: "100%", maxWidth: mobile ? undefined : 1178, margin: "0 auto" }}>
      {/* Tile-X chip grammar (all three shelves): rest = cream outline, no
          fill; hover = Accent fill, no outline; active returns to rest
          (Alborz 2026-09-05). Transparent hover border keeps the size stable. */}
      <style>{`
        .ref-lookup-x { background: transparent; border: 2px solid ${CREAM}; }
        .ref-lookup-x:hover { background: ${CANON.accent}; border-color: transparent; }
        .ref-lookup-x:active { background: transparent; border-color: ${CREAM}; }
      `}</style>

      {/* "Your canon" — the zone's FEATURED opener (Alborz 2026-09-07 rev 2):
          Heading 1 + centered Header-2 subhead, always present. Empty = four
          placeholder slots as the invitation. Curated here AND on reference
          pages; cards carry edit + essentials + the graduate X. */}
      <div>
        <h2 style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 28 : 34, letterSpacing: -1, color: CREAM, margin: 0, textAlign: "center" }}>
          Your canon
        </h2>
        <div style={{ fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, color: CREAM, textAlign: "center", margin: "10px auto 24px", maxWidth: 560, lineHeight: 1.5 }}>
          The shows you&rsquo;d put your name behind. The shows that mean something to you. The ones you think about regularly.
        </div>
        {canonList.length === 0 ? (
          <div style={{ display: "flex", gap: 18, justifyContent: "center", flexWrap: "wrap" }}>
            {[0, 1, 2, 3].map((i) => (
              <button
                key={i}
                onClick={() => { setSearchMode("canon"); setSearchOpen(true); setQuery(""); setTvResults([]); }}
                title="Add a show to your canon"
                style={{ width: mobile ? 74 : 110, height: mobile ? 105 : 156, borderRadius: 12, border: `2px dashed ${CREAM}`, background: "transparent", color: CREAM, fontSize: 28, fontWeight: 400, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                +
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 18, overflowX: "auto", paddingBottom: 6 }}>
            {canonList.map((show) => {
              const poster = posters[show.id];
              const entry = progress[show.id];
              const take = entry?.canonTake;
              const hasProgress = !!entry && (entry.s > 1 || (entry.s === 1 && entry.e >= 1));
              const goto = () => (hasProgress
                ? navigate(`${pathPrefix}/${show.id}`, { state: { openReference: true } })
                : openCard(show));
              const pw = mobile ? 96 : 110, ph = mobile ? 136 : 156;
              return (
                <div key={show.id} style={{ position: "relative", flexShrink: 0, width: mobile ? 300 : 400, display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <button onClick={goto} style={{ flex: "0 0 auto", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
                    {poster ? (
                      <img src={poster} alt={show.name} loading="lazy" style={{ width: pw, height: ph, objectFit: "cover", borderRadius: 12, display: "block" }} />
                    ) : (
                      <div style={{ width: pw, height: ph, borderRadius: 12, border: `2px solid ${CREAM}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
                        <span style={{ fontFamily: LORA, fontWeight: 700, fontSize: 14, color: CREAM, textAlign: "center" }}>{show.name}</span>
                      </div>
                    )}
                  </button>
                  <div style={{ minWidth: 0, paddingRight: 20, color: CREAM }}>
                    <button onClick={goto} style={{ display: "block", background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: CREAM }}>
                      <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 16 : 18, lineHeight: 1.2, margin: "2px 0 6px" }}>{show.name}</div>
                      {take && (
                        <div style={{ fontFamily: '"Inter", sans-serif', fontStyle: "italic", fontSize: 13, lineHeight: 1.5, opacity: 0.95 }}>
                          &ldquo;{take}&rdquo;
                        </div>
                      )}
                    </button>
                    {(entry?.essentialEps?.length ?? 0) > 0 ? (
                      <button
                        onClick={() => openShare(show)}
                        title="Open your shareable essentials card"
                        style={{ display: "block", background: "transparent", border: "none", padding: 0, marginTop: 8, cursor: "pointer", color: CREAM, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 12, textDecoration: "underline", textAlign: "left" }}
                      >
                        ★ {entry!.essentialEps!.length} essential episode{entry!.essentialEps!.length === 1 ? "" : "s"}
                      </button>
                    ) : (
                      // The essentials PROMPT (Alborz 2026-09-07 — the star
                      // feature was too hidden): straight to the reference
                      // page, where the stars live.
                      <button
                        onClick={goto}
                        title="Star this show's essential episodes on its reference page"
                        style={{ display: "block", background: "transparent", border: "none", padding: 0, marginTop: 8, cursor: "pointer", color: CREAM, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 12, textDecoration: "underline", textAlign: "left" }}
                      >
                        ★ pick its essential episodes
                      </button>
                    )}
                    <button
                      onClick={() => openCanonCard(show)}
                      style={{ display: "block", background: "transparent", border: "none", padding: 0, marginTop: 6, cursor: "pointer", color: CREAM, fontFamily: '"Inter", sans-serif', fontStyle: "italic", fontWeight: 400, fontSize: 12, textDecoration: "underline", textAlign: "left" }}
                    >
                      {take ? "edit your line" : "add your line"}
                    </button>
                  </div>
                  <button
                    className="ref-lookup-x"
                    onClick={() => removeCanon(show.id)}
                    aria-label={`Remove ${show.name} from your canon`}
                    title="Remove from your canon"
                    style={{ position: "absolute", top: 6, left: pw - 28, width: 22, height: 22, boxSizing: "border-box", borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                  >
                    <X size={13} color={CREAM} />
                  </button>
                </div>
              );
            })}
            {/* Trailing + tile keeps adding one tap away. */}
            <button
              onClick={() => { setSearchMode("canon"); setSearchOpen(true); setQuery(""); setTvResults([]); }}
              title="Add a show to your canon"
              style={{ flexShrink: 0, width: mobile ? 96 : 110, height: mobile ? 136 : 156, borderRadius: 12, border: `2px dashed ${CREAM}`, background: "transparent", color: CREAM, fontSize: 32, fontWeight: 400, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* Locked pitch (Alborz 2026-09-07 rev): desktop breaks evenly after
          "shows"; mobile balance-wraps (no orphans at any width). */}
      <h2 style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 22 : 28, color: CREAM, margin: "44px 0 0", textAlign: "center", ...(mobile ? { textWrap: "balance" as const } : {}) }}>
        {mobile
          ? <>Need to look something up about the shows you&rsquo;re watching without getting spoiled?</>
          : <>Need to look something up about the shows<br />you&rsquo;re watching without getting spoiled?</>}
      </h2>
      {/* Sub-head split (Alborz): desktop breaks after "detail —"; mobile
          can't fit that line, so it balance-wraps instead — near-equal
          lines, never an orphan word. */}
      <p style={{ fontFamily: '"Inter", sans-serif', fontSize: mobile ? 13 : 14, color: CREAM, opacity: 0.9, lineHeight: 1.5, margin: "10px auto 18px", maxWidth: 640, textAlign: "center", ...(mobile ? { textWrap: "balance" as const } : {}) }}>
        {mobile ? (
          <>Look up an actor, a plot point you missed, or crew detail — all of it, filtered to how far you&rsquo;ve watched.</>
        ) : (
          <>Look up an actor, a plot point you missed, or crew detail —<br />all of it, filtered to how far you&rsquo;ve watched.</>
        )}
      </p>

      {/* Search trigger — the group room's search-pill grammar (magnifying
          glass + text), Personal green on the yellow band (rev 2 2026-09-05). */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <button
          onClick={() => { setSearchMode("lookup"); setSearchOpen(true); setQuery(""); setTvResults([]); }}
          style={{ ...searchPill, background: CANON.personal, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 14 }}
        >
          <Search size={26} color={CREAM} strokeWidth={2} />find your show
        </button>
      </div>

      {/* "You're watching:" — your S1E1+ shows, recent activity first.
          Tapping goes STRAIGHT to the reference (no card — Alborz). */}
      {watching.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <div style={{ fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, color: CREAM, marginBottom: 10 }}>
            You&rsquo;re watching:
          </div>
          <div style={{ display: "flex", gap: mobile ? 10 : 14, overflowX: "auto", paddingBottom: 6 }}>
            {watching.map((show) => {
              const r = progress[show.id]!;
              const poster = posters[show.id];
              const w = mobile ? 96 : 120, h = mobile ? 136 : 170;
              return (
                <div key={show.id} style={{ position: "relative", flexShrink: 0, width: w }}>
                  <button
                    onClick={() => navigate(`${pathPrefix}/${show.id}`, { state: { openReference: true } })}
                    style={{ width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                  >
                    {poster ? (
                      <img src={poster} alt={show.name} loading="lazy" style={{ width: w, height: h, objectFit: "cover", borderRadius: 12, display: "block" }} />
                    ) : (
                      <div style={{ width: w, height: h, borderRadius: 12, border: `2px solid ${CREAM}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
                        <span style={{ fontFamily: LORA, fontWeight: 700, fontSize: 14, color: CREAM, textAlign: "center" }}>{show.name}</span>
                      </div>
                    )}
                    <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 12, fontWeight: 700, color: CREAM, marginTop: 6 }}>
                      {r.s >= 1 && r.e >= 1 ? `S${r.s} E${r.e}` : ""}
                    </div>
                  </button>
                  {/* Per-show de-clutter X — cream outline chip; Accent fill
                      on hover (styled via the class below: inline styles
                      can't express hover/active). */}
                  <button
                    className="ref-lookup-x"
                    onClick={() => hideShow(show.id)}
                    aria-label={`Hide ${show.name} from this shelf`}
                    title="Hide from this shelf"
                    style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, boxSizing: "border-box", borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                  >
                    <X size={13} color={CREAM} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* "You want to watch:" (CP2) — poster-only tiles; tap reopens the
          card (trailer + set your episode); X clears the stamp. */}
      {wantList.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <div style={{ fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, color: CREAM, marginBottom: 10 }}>
            You want to watch:
          </div>
          <div style={{ display: "flex", gap: mobile ? 10 : 14, overflowX: "auto", paddingBottom: 6 }}>
            {wantList.map((show) => {
              const poster = posters[show.id];
              const w = mobile ? 96 : 120, h = mobile ? 136 : 170;
              return (
                <div key={show.id} style={{ position: "relative", flexShrink: 0, width: w }}>
                  <button
                    onClick={() => openCard(show)}
                    style={{ width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                  >
                    {poster ? (
                      <img src={poster} alt={show.name} loading="lazy" style={{ width: w, height: h, objectFit: "cover", borderRadius: 12, display: "block" }} />
                    ) : (
                      <div style={{ width: w, height: h, borderRadius: 12, border: `2px solid ${CREAM}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
                        <span style={{ fontFamily: LORA, fontWeight: 700, fontSize: 14, color: CREAM, textAlign: "center" }}>{show.name}</span>
                      </div>
                    )}
                  </button>
                  <button
                    className="ref-lookup-x"
                    onClick={() => unwantShow(show.id)}
                    aria-label={`Remove ${show.name} from your want-to-watch list`}
                    title="Remove from this list"
                    style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, boxSizing: "border-box", borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                  >
                    <X size={13} color={CREAM} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* "You've finished:" (2026-09-07) — at the latest available episode
          (airing status irrelevant); graduate to canon from here. A new
          episode in the catalog moves a show back to Watching by itself. */}
      {finishedList.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <div style={{ fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, color: CREAM, marginBottom: 10 }}>
            You&rsquo;ve finished:
          </div>
          <div style={{ display: "flex", gap: mobile ? 10 : 14, overflowX: "auto", paddingBottom: 6 }}>
            {finishedList.map((show) => {
              const poster = posters[show.id];
              const w = mobile ? 96 : 120, h = mobile ? 136 : 170;
              return (
                <div key={show.id} style={{ position: "relative", flexShrink: 0, width: w }}>
                  <button
                    onClick={() => navigate(`${pathPrefix}/${show.id}`, { state: { openReference: true } })}
                    style={{ width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                  >
                    {poster ? (
                      <img src={poster} alt={show.name} loading="lazy" style={{ width: w, height: h, objectFit: "cover", borderRadius: 12, display: "block" }} />
                    ) : (
                      <div style={{ width: w, height: h, borderRadius: 12, border: `2px solid ${CREAM}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
                        <span style={{ fontFamily: LORA, fontWeight: 700, fontSize: 14, color: CREAM, textAlign: "center" }}>{show.name}</span>
                      </div>
                    )}
                  </button>
                  <button
                    onClick={() => openCanonCard(show)}
                    title={`Add ${show.name} to your canon`}
                    style={{ display: "block", background: "transparent", border: "none", padding: 0, marginTop: 6, cursor: "pointer", color: CREAM, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 12, textDecoration: "underline", textAlign: "left" }}
                  >
                    ★ add to canon
                  </button>
                  <button
                    className="ref-lookup-x"
                    onClick={() => hideShow(show.id)}
                    aria-label={`Hide ${show.name} from this shelf`}
                    title="Hide from this shelf"
                    style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, boxSizing: "border-box", borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                  >
                    <X size={13} color={CREAM} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Browse rows — the dashboard asks the PERSONAL question. The
          umbrella heading ties them to YOUR lists (CP1); row names drop a
          tier beneath it. */}
      <div style={{ marginTop: 44 }}>
        <div style={{ fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, color: CREAM, marginBottom: 4 }}>
          Find something to watch:
        </div>
        {mobile
          ? <MobileBrowseRows excludeTvmazeIds={EMPTY_EXCLUDE} onPick={pickBrowseShow} subLabels />
          : <BrowseRows excludeTvmazeIds={EMPTY_EXCLUDE} onPick={pickBrowseShow} subLabels />}
      </div>

      {/* ── The search overlay — the group room's search grammar: dim +
            cream card, input, results list scrolling inside the card. ── */}
      {searchOpen && (
        // Center is BIASED DOWN (paddingTop shifts the flex center ~10vh) so
        // the card reads as part of the reference world below; no X — the
        // dim-click closes (Alborz 2026-09-05).
        <div style={{ ...overlay, paddingTop: "20vh", boxSizing: "border-box" }} onClick={() => setSearchOpen(false)}>
          <div style={{ ...searchCard, maxHeight: "64vh", overflowY: "auto", position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="find your show"
              style={searchInput}
            />
            {busyAdd && <div style={{ color: CANON.personal, fontSize: 13, fontWeight: 700, padding: "8px 4px" }}>adding<LoadingDots /></div>}
            {catalogMatches.map((show) => (
              <button key={show.id} style={resultBtn} disabled={busyAdd} onClick={() => (searchMode === "canon" ? openCanonCard(show) : openCard(show))}>{show.name}</button>
            ))}
            {tvToAdd.map(({ tv, id }) => (
              <button key={id} style={resultBtn} disabled={busyAdd} onClick={() => pickTvShow(tv)}>
                {tv.name}{networkLabel(tv) ? <span style={{ fontWeight: 500, opacity: 0.75 }}> · {networkLabel(tv)}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── The canon card (2026-09-07) — add/edit from the dashboard: the
            yellow-card grammar; ADD also sets progress to the latest episode
            (stated on the card); EDIT saves the blurb only. ── */}
      {canonCard && (
        <div style={cardScrollOverlay} onClick={(e) => { if (e.target === e.currentTarget && !canonBusy) setCanonCard(null); }}>
          <div style={cardCenterColumn} onClick={(e) => { if (e.target === e.currentTarget && !canonBusy) setCanonCard(null); }}>
            <div style={yellowCard}>
              <button style={modalClose} onClick={() => { if (!canonBusy) setCanonCard(null); }} aria-label="Close">
                <X size={16} color={CREAM} />
              </button>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 26, color: CREAM, textAlign: "center", marginBottom: 18 }}>
                {canonCard.name}
              </div>
              <div style={yellowTitle}>Why is this in your canon?</div>
              {canonCard.adding && (
                <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 12, color: CREAM, opacity: 0.85, margin: "6px 0 0" }}>
                  (Adding a show to your canon sets your<br />progress to its latest episode.)
                </div>
              )}
              <textarea
                value={canonDraft}
                onChange={(ev) => setCanonDraft(ev.target.value)}
                maxLength={280}
                rows={5}
                autoFocus
                placeholder="Your take — as short or long as you like."
                style={{ width: "100%", boxSizing: "border-box", border: "none", borderRadius: 12, padding: "10px 12px", marginTop: 14, fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.5, resize: "vertical", textAlign: "left" }}
              />
              <div style={{ marginTop: 16 }}>
                {canonCard.show ? (
                  <button style={{ ...startBtn, minWidth: 210, boxSizing: "border-box" }} disabled={canonBusy} onClick={confirmCanon}>
                    {canonBusy ? <>one moment<LoadingDots /></> : canonCard.adding ? "add to your canon" : "save"}
                  </button>
                ) : (
                  <div style={{ color: CREAM, fontSize: 13, fontWeight: 700 }}>one moment<LoadingDots /></div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── The shareable "{Name}'s TV Canon" card (CP4) — cream, centered,
            screenshot-friendly; outside-click closes. ── */}
      {shareShow && (() => {
        const entry = progress[shareShow.id];
        const eps = [...(entry?.essentialEps ?? [])].sort((a, b) => a - b);
        const shareName = (profile?.display_name || profile?.username || "My").trim();
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
                <div style={{ fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, color: CANON.dark }}>{shareName}&rsquo;s TV Canon</div>
                <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 30, color: CANON.identity, margin: "2px 0 10px" }}>{shareShow.name}</div>
                {entry?.canonTake && (
                  <div style={{ fontFamily: '"Inter", sans-serif', fontStyle: "italic", fontSize: 14, color: CANON.dark, lineHeight: 1.5, marginBottom: 18 }}>
                    &ldquo;{entry.canonTake}&rdquo;
                  </div>
                )}
                <div style={{ borderTop: "1px solid rgba(26,58,74,0.15)", paddingTop: 14 }}>
                  <div style={{ fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, color: CANON.dark, marginBottom: 10 }}>
                    essential episodes according to {shareName}:
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
                {/* The REAL dynamic logo (Alborz 2026-09-07) — surfaceBg keeps
                    the cream block visible on the cream card (findings-card
                    precedent). */}
                <div style={{ marginTop: 16 }}>
                  <SidebarLogo scale={0.4} blocksOpacity={1} surfaceBg={CANON.cream} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── The first-tap card (locked copy) — the group opt-in modal's EXACT
            grammar (rev 2 2026-09-05): scrollable two-layer overlay centering
            [yellowCard + 8px gap + TrailerCard] as a pair, Lora show-name
            title, transparent progress pill, no outlines. Paints INSTANTLY on
            a pick; the picker fills in when the catalog show resolves. The
            "look it up" button exists only once an episode is picked. ── */}
      {(cardShow || cardPending) && (
        <div style={cardScrollOverlay} onClick={(e) => { if (e.target === e.currentTarget && !confirmBusy) { setCardShow(null); setCardPending(null); } }}>
          <div style={cardCenterColumn} onClick={(e) => { if (e.target === e.currentTarget && !confirmBusy) { setCardShow(null); setCardPending(null); } }}>
            <div style={yellowCard}>
              <button
                style={modalClose}
                onClick={() => { if (!confirmBusy) { setCardShow(null); setCardPending(null); } }}
                aria-label="Close"
              >
                <X size={16} color={CREAM} />
              </button>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 26, color: CREAM, textAlign: "center", marginBottom: 18 }}>
                {cardTitle}
              </div>
              <div style={yellowTitle}>How far in are you?</div>
              <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 12, color: CREAM, opacity: 0.85, margin: "6px 0 14px" }}>
                (Set your episode. Your reference page<br />will never go past it.)
              </div>
              {/* The pill + the want button share one width (Alborz mock). */}
              <style>{`.ref-card-pick select{width:210px;box-sizing:border-box;text-overflow:ellipsis}`}</style>
              <div className="ref-card-pick" style={{ display: "flex", justifyContent: "center" }}>
                {cardShow ? (
                  <OneSelectProgress
                    show={cardShow}
                    value={picked}
                    allowZero
                    requireConfirm={false}
                    pillBg="transparent"
                    onChangeSelected={(v: { s: number; e: number }) => setPicked(v)}
                    onConfirm={() => {}}
                  />
                ) : (
                  <div style={{ color: CREAM, fontSize: 13, fontWeight: 700, padding: "10px 0" }}>loading episodes<LoadingDots /></div>
                )}
              </div>
              {cardShow && pickedReady && (
                <div style={{ marginTop: 18 }}>
                  <button style={{ ...startBtn, width: 210, boxSizing: "border-box", paddingLeft: 0, paddingRight: 0 }} disabled={confirmBusy} onClick={lookItUp}>
                    {confirmBusy ? <>one moment<LoadingDots /></> : "look it up"}
                  </button>
                </div>
              )}
              {/* "haven't started" is no longer a dead end (CP2): the add is
                  the declaration itself. Hidden once the show's already on
                  the want shelf (the card then just offers the trailer /
                  progress). Never a proposal to any group. */}
              {cardShow && !pickedReady && !progress[cardShow.id]?.wantedAt && (
                <div style={{ marginTop: 18 }}>
                  <button style={{ ...startBtn, width: 210, boxSizing: "border-box", paddingLeft: 0, paddingRight: 0 }} disabled={wantBusy} onClick={wantIt}>
                    {wantBusy ? <>one moment<LoadingDots /></> : "want to watch"}
                  </button>
                </div>
              )}
            </div>
            <TrailerCard showId={cardShow?.id ?? `pending-${cardTvmazeId ?? "none"}`} tvmazeId={cardTvmazeId} />
          </div>
        </div>
      )}
    </div>
  );
}
