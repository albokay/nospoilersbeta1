/**
 * InviteShowSuggest — the invite wall's "Do you want to suggest shows too?"
 * block (Alborz, 2026-08-01). Rendered on BOTH invite arrivals (desktop
 * PublicDashboardPage wall / MobileGroupInviteAccept), logged-out.
 *
 * Search = the site catalog (anon-readable) + debounced TVMaze for shows we
 * don't have — the onboarding search's exact behavior, but ADDITIVE: each
 * result row carries a "+", picking appends a chip and re-arms the search
 * for another. Nothing is written here (no account yet): picks park in
 * localStorage per invite token (lib/invitePicks) and are claimed as real
 * group proposals right after the invite is accepted.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { fetchShows, type Show } from "../lib/db";
import { tvmazeSearch, networkLabel, slugify, type TVmazeShow } from "../lib/tvmaze";
import { readInvitePicks, parkInvitePicks, type InviteShowPick } from "../lib/invitePicks";
import { preventLastWordOrphan } from "../lib/utils";
import { CANON } from "../styles/canon";
import BrowseRows from "./BrowseRows";
import MobileBrowseRows from "../mobile/MobileBrowseRows";
import type { BrowseShow } from "../lib/db";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export default function InviteShowSuggest({ token, idiom, excludeTvmazeIds, bleedX = 0, children }: {
  token: string;
  idiom: "desktop" | "mobile";
  /** The inviter's shows shown on the wall above (already on the table) —
   *  hidden from the browse rows. */
  excludeTvmazeIds?: Set<number>;
  /** Mobile: the wall's horizontal padding to cancel so the poster strips
   *  run edge-to-edge like the group room's. */
  bleedX?: number;
  /** Rendered BETWEEN the search card and the browse rows — the walls pass
   *  their JOIN YOUR FRIEND cluster here (Alborz 2026-08-18: the button and
   *  "…and start writing." sit above the thumbnails). */
  children?: React.ReactNode;
}) {
  const mobile = idiom === "mobile";
  const [shows, setShows] = useState<Show[]>([]);
  const [query, setQuery] = useState("");
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [picks, setPicks] = useState<InviteShowPick[]>(() => readInvitePicks(token));
  const tvDebounceRef = useRef<number | null>(null);
  // Mobile keyboard fix (Alborz 2026-08-11): results grow the page BELOW
  // the keyboard while iOS pins the focused input near the visible bottom —
  // so they rendered into the hidden zone. Scroll the search card to the
  // top of the visible band on focus (and when results first land), so the
  // input + the capped result list sit above the keyboard.
  const cardRef = useRef<HTMLDivElement | null>(null);
  function ensureVisible() {
    if (!mobile) return;
    window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 260); // after the keyboard animation settles
  }

  useEffect(() => {
    let cancelled = false;
    fetchShows().then((rows) => { if (!cancelled) setShows(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Catalog matches + debounced TVMaze lookup — the onboarding search's
  // behavior (SocialOnboarding), minus anything that writes.
  const pickedIds = useMemo(
    () => new Set(picks.map((p) => (p.kind === "catalog" ? p.id : slugify(p.name)))),
    [picks],
  );
  const catalogMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shows.filter((s) => !s.isHidden && !pickedIds.has(s.id) && s.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, shows, pickedIds]);

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
      if (known.has(id) || seen.has(id) || pickedIds.has(id)) continue;
      seen.add(id);
      out.push({ tv, id });
      if (out.length >= 6) break;
    }
    return out;
  }, [tvResults, shows, pickedIds]);

  function commit(next: InviteShowPick[]) {
    setPicks(next);
    parkInvitePicks(token, next); // park on EVERY change — the join hop leaves this page
  }
  function addPick(p: InviteShowPick) {
    commit([...picks, p]);
    setQuery("");
    setTvResults([]);
  }
  function removePick(i: number) {
    commit(picks.filter((_, j) => j !== i));
  }

  // Browse rows (2026-08-18): the group room's poster shelves, under the
  // search — a tap adds a chip like a search hit (catalog pick when Sidebar
  // already has the show, else a TVMaze pick claimed on accept). Hidden:
  // the inviter's shows above + anything already picked.
  const browseExclude = useMemo(() => {
    const ids = new Set<number>(excludeTvmazeIds ?? []);
    for (const p of picks) {
      if (p.kind === "tv") ids.add(p.tvmazeId);
      else { const tv = shows.find((s) => s.id === p.id)?.tvmazeId; if (tv) ids.add(Number(tv)); }
    }
    return ids;
  }, [excludeTvmazeIds, picks, shows]);
  function addFromBrowse(b: BrowseShow) {
    const cat = shows.find((s) => s.tvmazeId === String(b.tvmazeId));
    addPick(cat ? { kind: "catalog", id: cat.id, name: cat.name } : { kind: "tv", tvmazeId: b.tvmazeId, name: b.name });
  }

  const hasResults = catalogMatches.length > 0 || tvToAdd.length > 0;
  useEffect(() => {
    if (hasResults) ensureVisible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasResults]);

  return (
    // Mobile marginTop 16 (was 48; Alborz 2026-08-11) — the shelves and this
    // question read as one unit; the big gap moved up to logo→content.
    <div style={{ textAlign: "center", marginTop: mobile ? 16 : 72 }}>
      <h2 style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 24 : 34, letterSpacing: 0, color: CANON.cream, margin: "0 0 4px" }}>
        {preventLastWordOrphan("Do you want to suggest shows too?")}
      </h2>
      <div style={{ color: CANON.cream, fontSize: mobile ? 13 : 15, marginBottom: 20 }}>(You can also do this later.)</div>

      {picks.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10, margin: "0 auto 16px", maxWidth: 560 }}>
          {picks.map((p, i) => (
            <span key={i} style={chip}>
              {p.name}
              <button aria-label={`remove ${p.name}`} style={chipX} onClick={() => removePick(i)}><X size={14} /></button>
            </span>
          ))}
        </div>
      )}

      <div ref={cardRef} style={{ ...searchCard, width: mobile ? "min(340px, 88vw)" : 380, ...(mobile ? { scrollMarginTop: 12 } : {}) }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={ensureVisible}
          placeholder="find your show"
          style={searchInput}
        />
        {hasResults && (
          // Mobile: the list scrolls internally past ~a third of the screen
          // so it can never outgrow the band above the keyboard.
          <div style={{ marginTop: 8, textAlign: "left", ...(mobile ? { maxHeight: "34dvh", overflowY: "auto", WebkitOverflowScrolling: "touch" as const } : {}) }}>
            {catalogMatches.map((s) => (
              <button key={s.id} style={resultRow} onClick={() => addPick({ kind: "catalog", id: s.id, name: s.name })}>
                <span style={resultName}>{s.name}</span><Plus size={16} strokeWidth={2.5} />
              </button>
            ))}
            {tvToAdd.map(({ tv, id }) => (
              <button key={id} style={resultRow} onClick={() => addPick({ kind: "tv", tvmazeId: tv.id, name: tv.name, status: tv.status })}>
                <span style={resultName}>{tv.name}{networkLabel(tv) ? ` · ${networkLabel(tv)}` : ""}</span><Plus size={16} strokeWidth={2.5} />
              </button>
            ))}
          </div>
        )}
        {query.trim().length >= 2 && catalogMatches.length === 0 && tvToAdd.length === 0 && (
          <div style={{ padding: "12px 16px", fontSize: 13, color: CANON.dark, opacity: 0.6, textAlign: "left" }}>searching&hellip;</div>
        )}
      </div>

      {children}

      {/* The poster rows, rendered exactly as in the group room (Alborz
          2026-08-18). Mobile strips cancel the wall's side padding so they
          run to the screen edges. */}
      <div style={{ textAlign: "left", marginTop: 28, ...(mobile && bleedX ? { marginLeft: -bleedX, marginRight: -bleedX } : {}) }}>
        {mobile
          ? <MobileBrowseRows excludeTvmazeIds={browseExclude} onPick={addFromBrowse} />
          : <BrowseRows excludeTvmazeIds={browseExclude} onPick={addFromBrowse} />}
      </div>
    </div>
  );
}

// Self-contained styles — the wall pages each carry their own scoped CSS, so
// this block depends on none of it.
const searchCard: React.CSSProperties = {
  margin: "0 auto", background: CANON.cream, borderRadius: 15, padding: 10, boxSizing: "border-box",
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)", textAlign: "center",
};
const searchInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `2px solid ${CANON.friend}`, borderRadius: 12,
  padding: "12px 14px", fontFamily: '"Inter", sans-serif', fontSize: 16, color: CANON.dark, outline: "none",
};
const resultRow: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  width: "100%", textAlign: "left", border: "none", background: "transparent",
  padding: "12px 16px", borderRadius: 12, cursor: "pointer",
  fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 600, color: CANON.personal,
};
const resultName: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const chip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  border: `2px solid ${CANON.cream}`, color: CANON.cream, background: "transparent",
  borderRadius: 65, padding: "10px 12px 10px 20px",
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: -0.5,
};
const chipX: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: "none", background: "transparent", color: CANON.cream, cursor: "pointer", padding: 2,
};
