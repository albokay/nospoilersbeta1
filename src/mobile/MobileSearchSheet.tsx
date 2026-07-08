import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { CANON } from "../styles/canon";
import OneSelectProgress from "../components/OneSelectProgress";
import { createShow, type Show } from "../lib/db";
import { tvmazeSearch, tvmazeEpisodes, networkLabel, slugify, type TVmazeShow } from "../lib/tvmaze";
import type { ProgressEntry } from "../types";

/**
 * Full-screen show search (mobile idiom of the desktop dashboard's cream
 * search overlay) — shared by MobileDashboard and MobileGroupRoom, since the
 * desktop search overlay serves both contexts too. Same behavior as desktop:
 * catalog results first (in-pool notes, out-of-pool "restore"), then TVMaze
 * matches to add a not-yet-cataloged show, then the "How much have you
 * watched?" picker before adding.
 *
 * The parent owns what happens on add/restore (rail/group refreshes differ
 * by context); this component owns the search/pick UI + TVMaze create.
 */

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const C = { green: CANON.personal, blue: CANON.identity, cream: CANON.cream, midnight: CANON.dark };

export default function MobileSearchSheet({
  shows, progress, outOfPool, groupContext, onClose, onAdd, onRestore, onCatalogAdd,
}: {
  shows: Show[];
  progress: Record<string, ProgressEntry>;
  outOfPool: Set<string>;
  /** Group-scoped model (2026-07-06, desktop parity): inside a group the
   *  search PROPOSES. A show already surfaced in the group reads "already in
   *  this group"; a hit you have any progress row for (in or out of the
   *  personal pool) proposes directly with no picker, progress untouched. */
  groupContext?: {
    groupShowIds: Set<string>;
    onProposeExisting: (show: Show) => void;
  };
  onClose: () => void;
  /** Add a picked show at the picked progress (parent persists + closes). */
  onAdd: (show: Show, val: { s: number; e: number }) => void;
  /** Re-add a removed show (restores saved progress; parent persists + closes).
   *  Personal context only — the group context proposes instead. */
  onRestore?: (show: Show) => void;
  /** A TVMaze show was just created in the catalog — merge into parent state. */
  onCatalogAdd: (show: Show) => void;
}) {
  const [query, setQuery] = useState("");
  const [pickShow, setPickShow] = useState<Show | null>(null);
  const [pickProgress, setPickProgress] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [tvLoading, setTvLoading] = useState(false);
  const [creatingShow, setCreatingShow] = useState(false);
  const tvDebounceRef = useRef<number | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shows
      .filter((s) => !s.isHidden && s.name.toLowerCase().includes(q))
      .map((s) => ({
        show: s,
        // In a group, "already added" means already in THIS group (proposal
        // or room) — the personal pool doesn't gate proposing here.
        inPool: groupContext ? groupContext.groupShowIds.has(s.id) : !!progress[s.id] && !outOfPool.has(s.id),
      }))
      .slice(0, 8);
  }, [query, shows, progress, outOfPool, groupContext]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setTvResults([]); setTvLoading(false); return; }
    if (tvDebounceRef.current) window.clearTimeout(tvDebounceRef.current);
    let cancelled = false;
    setTvLoading(true);
    tvDebounceRef.current = window.setTimeout(async () => {
      try {
        const r = await tvmazeSearch(q);
        if (!cancelled) setTvResults(r);
      } catch { if (!cancelled) setTvResults([]); }
      finally { if (!cancelled) setTvLoading(false); }
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
      if (out.length >= 8) break;
    }
    return out;
  }, [tvResults, shows]);

  async function addFromTvmaze(tv: TVmazeShow) {
    if (creatingShow) return;
    setCreatingShow(true);
    try {
      const seasons = await tvmazeEpisodes(tv.id);
      const show = await createShow({
        id: slugify(tv.name),
        name: tv.name,
        seasons,
        tvmazeId: String(tv.id),
        status: tv.status,
      });
      onCatalogAdd(show);
      setTvResults([]);
      setPickShow(show);
      setPickProgress({ s: 0, e: 0 });
    } catch (e) {
      console.error("[m-search] add show from TVMaze failed", e);
    } finally {
      setCreatingShow(false);
    }
  }

  return (
    <div style={sheet}>
      <button style={sheetClose} onClick={onClose}><X size={20} color={C.green} /></button>
      {!pickShow ? (
        <div style={sheetInner}>
          <input
            autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="find your show" style={searchInput} className="m-search"
          />
          {results.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {results.map(({ show: s, inPool }) => (
                inPool ? (
                  <div key={s.id} style={{ ...resultRow, cursor: "default", opacity: 0.55 }}>
                    {groupContext ? <><i>{s.name}</i> is already in this group.</> : <>You&rsquo;ve already added <i>{s.name}</i> to your watch pool.</>}
                  </div>
                ) : groupContext ? (
                  // A show with an existing progress row proposes as-is (no
                  // picker — saved progress kept); anything else picks first.
                  <button key={s.id} style={resultRow} onClick={() => { if (progress[s.id]) { groupContext.onProposeExisting(s); } else { setPickShow(s); setPickProgress({ s: 0, e: 0 }); } }}>
                    {s.name}
                  </button>
                ) : (
                  <button key={s.id} style={resultRow} onClick={() => { if (outOfPool.has(s.id)) { onRestore?.(s); } else { setPickShow(s); setPickProgress({ s: 0, e: 0 }); } }}>
                    {s.name}{outOfPool.has(s.id) ? " · restore" : ""}
                  </button>
                )
              ))}
            </div>
          )}
          {tvToAdd.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {results.length > 0 && (
                <div style={{ padding: "4px 16px 6px", fontSize: 11, fontWeight: 700, color: C.midnight, opacity: 0.6 }}>Not in the list? Add it:</div>
              )}
              {tvToAdd.map(({ tv, id }) => (
                <button key={id} style={resultRow} disabled={creatingShow} onClick={() => addFromTvmaze(tv)}>
                  {tv.name}{networkLabel(tv) ? ` · ${networkLabel(tv)}` : ""}
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && results.length === 0 && tvToAdd.length === 0 && (
            <div style={{ padding: "12px 16px", fontSize: 13, color: C.midnight, opacity: 0.6 }}>
              {creatingShow ? "adding…" : tvLoading ? "searching…" : "No shows found."}
            </div>
          )}
        </div>
      ) : (
        <div style={{ ...sheetInner, textAlign: "center" }}>
          <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 30, letterSpacing: 0, color: C.green }}>
            {pickShow.name}
          </div>
          <div style={{ marginTop: 24, color: C.green, fontWeight: 600, fontSize: 13, letterSpacing: -1 }}>
            How much have you watched?
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
            <OneSelectProgress
              show={pickShow}
              value={{ s: 0, e: 0 }}
              allowZero
              requireConfirm={false}
              onChangeSelected={(v) => setPickProgress(v)}
              onConfirm={() => {}}
            />
          </div>
          <button style={addBtn} onClick={() => onAdd(pickShow, pickProgress)}>
            add to my shows
          </button>
        </div>
      )}
    </div>
  );
}

const sheet: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, overflowY: "auto",
  WebkitOverflowScrolling: "touch", background: C.cream,
  paddingTop: "calc(env(safe-area-inset-top, 0px) + 64px)",
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)",
  boxSizing: "border-box",
};
const sheetClose: React.CSSProperties = {
  position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 12px)", right: 12,
  width: 44, height: 44, border: "none", background: "transparent", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center", zIndex: 1001,
};
const sheetInner: React.CSSProperties = { maxWidth: 420, margin: "0 auto", padding: "0 20px" };
const searchInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `2px solid ${C.green}`, borderRadius: 65,
  padding: "14px 24px", fontFamily: '"Inter", sans-serif', fontSize: 16, color: C.green,
  background: "transparent", outline: "none",
};
const resultRow: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent",
  padding: "14px 16px", borderRadius: 12, cursor: "pointer", fontFamily: '"Inter", sans-serif',
  fontSize: 15, fontWeight: 600, color: C.green, minHeight: 44, boxSizing: "border-box",
};
const addBtn: React.CSSProperties = {
  border: "none", background: C.blue, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "14px 40px", borderRadius: 65, cursor: "pointer", minHeight: 44, marginTop: 24,
};
