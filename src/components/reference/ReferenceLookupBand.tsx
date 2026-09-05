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
import { X } from "lucide-react";
import { CANON } from "../../styles/canon";
import { useAuth } from "../../lib/auth";
import {
  fetchShows, fetchProgress, createShow, type Show,
} from "../../lib/db";
import type { ProgressEntry } from "../../types";
import { tvmazeSearch, tvmazeEpisodes, networkLabel, slugify, fetchTvmazePoster, type TVmazeShow } from "../../lib/tvmaze";
import { ensureCatalogShow } from "../../lib/browseCatalog";
import type { BrowseShow } from "../../lib/db";
import { fetchRecentLookups, stampReferenceLookup } from "../../lib/reference";
import { upsertRewatchStatus } from "../../lib/db";
import BrowseRows from "../BrowseRows";
import MobileBrowseRows from "../../mobile/MobileBrowseRows";
import OneSelectProgress from "../OneSelectProgress";
import TrailerCard from "../TrailerCard";
import LoadingDots from "../LoadingDots";
import { yellowCard, startBtn } from "../dashboardChrome";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const CREAM = CANON.cream;
const EMPTY_EXCLUDE = new Set<number>();

export default function ReferenceLookupBand({ mobile = false }: { mobile?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const pathPrefix = mobile ? "/m/show-room/private" : "/show-room/private";

  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [recents, setRecents] = useState<{ showId: string; s: number; e: number }[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});

  const [query, setQuery] = useState("");
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [busyAdd, setBusyAdd] = useState(false);
  const tvDebounceRef = useRef<number | null>(null);

  // The first-tap card ("How far in are you?").
  const [cardShow, setCardShow] = useState<Show | null>(null);
  const [picked, setPicked] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [confirmBusy, setConfirmBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchShows().then((rows) => { if (!cancelled) setShows(rows); }).catch(() => {});
    fetchProgress(user.id).then((p) => { if (!cancelled) setProgress(p); }).catch(() => {});
    fetchRecentLookups(user.id).then((r) => { if (!cancelled) setRecents(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  // Posters for the recent row (TVMaze medium, module-cached).
  useEffect(() => {
    let cancelled = false;
    for (const r of recents) {
      const show = shows.find((s) => s.id === r.showId);
      if (!show?.tvmazeId || posters[r.showId] !== undefined) continue;
      fetchTvmazePoster(show.tvmazeId).then((url) => {
        if (!cancelled) setPosters((prev) => ({ ...prev, [r.showId]: url }));
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recents, shows]);

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
    setQuery("");
    setTvResults([]);
  }

  async function pickTvShow(tv: TVmazeShow) {
    if (busyAdd) return;
    setBusyAdd(true);
    try {
      const seasons = await tvmazeEpisodes(tv.id);
      const created = await createShow({ id: slugify(tv.name), name: tv.name, seasons, tvmazeId: String(tv.id), status: tv.status });
      setShows((prev) => (prev.some((s) => s.id === created.id) ? prev : [...prev, created]));
      openCard(created);
    } catch (e) { console.error("[ref-band] add show failed", e); }
    finally { setBusyAdd(false); }
  }

  async function pickBrowseShow(b: BrowseShow) {
    if (busyAdd) return;
    setBusyAdd(true);
    try {
      const show = await ensureCatalogShow(shows, b);
      setShows((prev) => (prev.some((s) => s.id === show.id) ? prev : [...prev, show]));
      openCard(show);
    } catch (e) { console.error("[ref-band] browse pick failed", e); }
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
      await stampReferenceLookup(user.id, cardShow.id);
      navigate(`${pathPrefix}/${cardShow.id}`, { state: { openReference: true } });
    } catch (e) {
      console.error("[ref-band] look-it-up failed", e);
      setConfirmBusy(false);
    }
  }

  if (!user) return null;

  const resultBtn: React.CSSProperties = {
    display: "block", width: "100%", textAlign: "left", border: "none", cursor: "pointer",
    background: CREAM, color: CANON.personal, fontWeight: 700, fontSize: 14,
    padding: "10px 16px", borderRadius: 12, marginTop: 6,
  };

  return (
        // Desktop width matches the browse window (1178) — heading/sub/search
    // self-cap narrower and center inside.
    <div style={{ width: "100%", maxWidth: mobile ? undefined : 1178, margin: mobile ? "40px 0 0" : "56px auto 0" }}>
      {/* Locked copy (Alborz 2026-09-05). */}
      <h2 style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 22 : 28, color: CREAM, margin: 0, textAlign: "center" }}>
        Need to look something up without getting spoiled?
      </h2>
      <p style={{ fontFamily: '"Inter", sans-serif', fontSize: mobile ? 13 : 14, color: CREAM, opacity: 0.9, lineHeight: 1.5, margin: "10px auto 18px", maxWidth: 520, textAlign: "center" }}>
        Look up an actor, a plot point you missed, or crew detail — all of it, filtered to how far you&rsquo;ve watched.
      </p>

      {/* Search — the site's standard placeholder. */}
      <div style={{ maxWidth: 420, margin: "0 auto" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="find your show"
          style={{
            width: "100%", boxSizing: "border-box", border: "none", borderRadius: 65,
            padding: "13px 22px", fontFamily: '"Inter", sans-serif', fontSize: 14,
            background: CREAM, color: CANON.dark, outline: "none",
          }}
        />
        {(catalogMatches.length > 0 || tvToAdd.length > 0 || busyAdd) && query.trim() && (
          <div style={{ marginTop: 4 }}>
            {busyAdd && <div style={{ color: CREAM, fontSize: 13, fontWeight: 700, padding: "8px 4px" }}>adding<LoadingDots /></div>}
            {catalogMatches.map((s) => (
              <button key={s.id} style={resultBtn} disabled={busyAdd} onClick={() => openCard(s)}>{s.name}</button>
            ))}
            {tvToAdd.map(({ tv, id }) => (
              <button key={id} style={resultBtn} disabled={busyAdd} onClick={() => pickTvShow(tv)}>
                {tv.name}{networkLabel(tv) ? <span style={{ fontWeight: 500, opacity: 0.75 }}> · {networkLabel(tv)}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* "You've looked up:" — cross-device, newest first, capped at 8.
          Tapping goes STRAIGHT to the reference (no card — Alborz). */}
      {recents.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontFamily: '"Inter", sans-serif', fontStyle: "italic", fontWeight: 400, fontSize: 13, color: CREAM, marginBottom: 10 }}>
            You&rsquo;ve looked up:
          </div>
          <div style={{ display: "flex", gap: mobile ? 10 : 14, overflowX: "auto", paddingBottom: 6 }}>
            {recents.map((r) => {
              const show = shows.find((s) => s.id === r.showId);
              if (!show) return null;
              const poster = posters[r.showId];
              const w = mobile ? 96 : 120, h = mobile ? 136 : 170;
              return (
                <button
                  key={r.showId}
                  onClick={() => navigate(`${pathPrefix}/${r.showId}`, { state: { openReference: true } })}
                  style={{ flexShrink: 0, width: w, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
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
              );
            })}
          </div>
        </div>
      )}

      {/* Browse rows — the dashboard asks the PERSONAL question. */}
      <div style={{ marginTop: 28 }}>
        {mobile
          ? <MobileBrowseRows excludeTvmazeIds={EMPTY_EXCLUDE} onPick={pickBrowseShow} />
          : <BrowseRows excludeTvmazeIds={EMPTY_EXCLUDE} onPick={pickBrowseShow} />}
      </div>

      {/* ── The first-tap card (locked copy): yellow, trailer, picker,
            "look it up" disabled until S1E1+. ── */}
      {cardShow && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(26,58,74,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}
          onClick={() => { if (!confirmBusy) setCardShow(null); }}
        >
          <div
            style={{ ...yellowCard, width: "min(480px, 92vw)", maxHeight: "88vh", overflowY: "auto", position: "relative", textAlign: "left" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { if (!confirmBusy) setCardShow(null); }}
              aria-label="Close"
              style={{ position: "absolute", top: 14, right: 14, background: "transparent", border: "none", cursor: "pointer", padding: 4, lineHeight: 0 }}
            >
              <X size={20} color={CREAM} />
            </button>
            <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: CREAM, marginBottom: 4 }}>
              {cardShow.name}
            </div>
            <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 18, color: CREAM, margin: "10px 0 4px" }}>
              How far in are you?
            </div>
            <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 12, color: CREAM, opacity: 0.85, marginBottom: 12 }}>
              (Set your episode. Your reference page will never go past it.)
            </div>
            <OneSelectProgress
              show={cardShow}
              value={picked}
              allowZero
              requireConfirm={false}
              onChangeSelected={(v: { s: number; e: number }) => setPicked(v)}
              onConfirm={() => {}}
            />
            <div style={{ textAlign: "center", marginTop: 18 }}>
              <button
                style={{ ...startBtn, opacity: pickedReady && !confirmBusy ? 1 : 0.5, cursor: pickedReady ? "pointer" : "default" }}
                disabled={!pickedReady || confirmBusy}
                onClick={lookItUp}
              >
                {confirmBusy ? <>one moment<LoadingDots /></> : "look it up"}
              </button>
            </div>
            <div style={{ marginTop: 16 }}>
              <TrailerCard showId={cardShow.id} tvmazeId={cardShow.tvmazeId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
