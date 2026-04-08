import React, { useState, useMemo, useEffect, useRef } from "react";
import type { Show } from "../lib/db";
import { createShow } from "../lib/db";
import { useAuth } from "../lib/auth";
import type { ProgressEntry } from "../types";

// ── TVmaze helpers ─────────────────────────────────────────────────────────

type TVmazeShow = {
  id: number;
  name: string;
  network?: { name: string } | null;
  webChannel?: { name: string } | null;
  premiered?: string | null;
  status?: string;
};

async function tvmazeSearch(q: string): Promise<TVmazeShow[]> {
  const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data ?? []).map((r: any) => r.show).filter(Boolean);
}

async function tvmazeEpisodes(tvmazeId: number): Promise<number[]> {
  const res = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/episodes`);
  if (!res.ok) return [1];
  const episodes: any[] = await res.json();
  const bySeason: Record<number, number> = {};
  for (const ep of episodes) {
    if (ep.type === "regular" || !ep.type) {
      bySeason[ep.season] = (bySeason[ep.season] ?? 0) + 1;
    }
  }
  const maxSeason = Math.max(...Object.keys(bySeason).map(Number));
  const seasons: number[] = [];
  for (let i = 1; i <= maxSeason; i++) {
    seasons.push(bySeason[i] ?? 1);
  }
  return seasons.length ? seasons : [1];
}

function networkLabel(s: TVmazeShow): string {
  const net = s.network?.name || s.webChannel?.name || "";
  const year = s.premiered ? s.premiered.slice(0, 4) : "";
  return [net, year].filter(Boolean).join(", ");
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32) || `show${Date.now()}`;
}

// ── Inline episode selector ────────────────────────────────────────────────

function EpisodeSelectInline({
  seasons,
  value,
  onChange,
}: {
  seasons: number[];
  value: { s: number; e: number };
  onChange: (v: { s: number; e: number }) => void;
}) {
  const options: { s: number; e: number; label: string }[] = [];
  seasons.forEach((epCount, idx) => {
    const s = idx + 1;
    for (let e = 1; e <= epCount; e++) {
      options.push({ s, e, label: `S${s} E${e}` });
    }
  });
  const val = `s${value.s}e${value.e}`;
  return (
    <select
      value={val}
      onChange={(ev) => {
        const m = ev.target.value.match(/^s(\d+)e(\d+)$/);
        if (m) onChange({ s: Number(m[1]), e: Number(m[2]) });
      }}
      style={{
        background: "#fff", color: "#000",
        border: "1px solid var(--dos-border)", borderRadius: 6,
        padding: "4px 8px", fontSize: 13, width: "100%",
      }}
    >
      {seasons.map((epCount, idx) => {
        const s = idx + 1;
        const eps = Array.from({ length: epCount }, (_, i) => i + 1);
        return (
          <optgroup key={s} label={`Season ${s}`}>
            {eps.map(e => (
              <option key={e} value={`s${s}e${e}`}>S{s} E{e}</option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SearchShows({ shows, onPick, onShowCreated, onAuthRequired, style, placeholder }: {
  shows: Show[];
  onPick: (showId: string) => void;
  onShowCreated?: (show: Show, entry: ProgressEntry) => void;
  onAuthRequired?: () => void;
  style?: React.CSSProperties;
  placeholder?: string;
  // legacy prop kept for compat — no longer used
  onStartNewForum?: (query: string) => void;
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // TVmaze async results
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [tvLoading, setTvLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Confirmation modal state
  const [confirming, setConfirming] = useState<TVmazeShow | null>(null);
  const [confirmingSeasons, setConfirmingSeasons] = useState<number[] | null>(null);
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Watch-status questionnaire state (lives inside the combined modal)
  const [watchChoice, setWatchChoice] = useState<"first" | "rewatch" | null>(null);
  const [highestSel, setHighestSel] = useState<{ s: number; e: number }>({ s: 1, e: 1 });
  const [rewatchSel, setRewatchSel] = useState<{ s: number; e: number }>({ s: 1, e: 1 });
  const [firstTimeSel, setFirstTimeSel] = useState<{ s: number; e: number }>({ s: 1, e: 1 });

  // Tier 1: existing shows on Sidebar (not hidden)
  const localMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shows.filter(s => !s.isHidden && s.name.toLowerCase().includes(q));
  }, [query, shows]);

  // IDs already on Sidebar (for dedup) — exclude the "bb" demo room so
  // users can still create a real Breaking Bad room via find-a-show.
  const existingTvmazeIds = useMemo(() =>
    new Set(shows.filter(s => s.id !== "bb").map(s => s.tvmazeId).filter(Boolean) as string[]),
    [shows]);

  // Tier 2: TVmaze results, deduped
  const tvMatches = useMemo(() =>
    tvResults.filter(r => !existingTvmazeIds.has(String(r.id))).slice(0, 6),
    [tvResults, existingTvmazeIds]);

  // Debounced TVmaze fetch
  useEffect(() => {
    const q = query.trim();
    if (!q) { setTvResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setTvLoading(true);
      try {
        const results = await tvmazeSearch(q);
        setTvResults(results);
      } catch { setTvResults([]); }
      finally { setTvLoading(false); }
    }, 320);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const resetModal = () => {
    setConfirming(null);
    setConfirmingSeasons(null);
    setCreateError(null);
    setWatchChoice(null);
    setHighestSel({ s: 1, e: 1 });
    setRewatchSel({ s: 1, e: 1 });
    setFirstTimeSel({ s: 1, e: 1 });
  };

  const handlePickLocal = (show: Show) => {
    onPick(show.id);
    setQuery(show.name);
    setOpen(false);
  };

  const handlePickTVmaze = async (tv: TVmazeShow) => {
    if (!user) {
      setOpen(false);
      onAuthRequired?.();
      return;
    }
    setConfirming(tv);
    setConfirmingSeasons(null);
    setOpen(false);
    setCreateError(null);
    setWatchChoice(null);
    setHighestSel({ s: 1, e: 1 });
    setRewatchSel({ s: 1, e: 1 });
    setFirstTimeSel({ s: 1, e: 1 });
    // Fetch episode data immediately so the selects are ready when the user needs them
    setSeasonsLoading(true);
    try {
      const seasons = await tvmazeEpisodes(tv.id);
      setConfirmingSeasons(seasons);
    } catch {
      setConfirmingSeasons([1]);
    } finally {
      setSeasonsLoading(false);
    }
  };

  const handleConfirmCreate = async () => {
    if (!confirming || !watchChoice) return;
    setCreating(true);
    setCreateError(null);
    try {
      const seasons = confirmingSeasons ?? [1];
      const id = slugify(confirming.name);
      const newShow = await createShow({
        id,
        name: confirming.name,
        seasons,
        tvmazeId: String(confirming.id),
        status: confirming.status === "Running" ? "Running" : "Ended",
      });

      // Build the ProgressEntry from the questionnaire answers
      let entry: ProgressEntry;
      if (watchChoice === "rewatch") {
        entry = {
          s: rewatchSel.s, e: rewatchSel.e,
          isRewatching: true,
          rewatchS: rewatchSel.s, rewatchE: rewatchSel.e,
          highestS: highestSel.s, highestE: highestSel.e,
        };
      } else {
        entry = { s: firstTimeSel.s, e: firstTimeSel.e, isRewatching: false };
      }

      setQuery(newShow.name);
      resetModal();
      if (onShowCreated) {
        onShowCreated(newShow, entry);
      } else {
        onPick(newShow.id);
      }
    } catch (e: any) {
      setCreateError(e?.message ?? "Failed to create forum. Try again.");
    } finally {
      setCreating(false);
    }
  };

  const totalItems = localMatches.length + tvMatches.length;
  const canSubmit = !!watchChoice && !seasonsLoading && !creating;

  return (
    <>
      <div className="splashSearchWrap" style={style}>
        <span className="splashSearchIcon" aria-hidden>🔍</span>
        <input
          placeholder={placeholder ?? "find a show"}
          className="splashSearch"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          aria-autocomplete="list"
          aria-expanded={open && !!query}
          aria-controls="search-suggest"
        />
        {open && !!query.trim() && (
          <div id="search-suggest" className="card dropdownPanel" role="listbox" style={{ left: 0, right: 0, width: "auto" }}>

            {/* Tier 1 */}
            {localMatches.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", opacity: 0.6, padding: "6px 8px 2px" }}>
                  ALREADY ON SIDEBAR
                </div>
                {localMatches.map((m) => (
                  <div
                    key={m.id}
                    role="option"
                    style={{ padding: "6px 8px", cursor: "pointer" }}
                    onMouseDown={(e) => { e.preventDefault(); handlePickLocal(m); }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {m.name}
                  </div>
                ))}
              </>
            )}

            {/* Divider between tiers */}
            {localMatches.length > 0 && (tvMatches.length > 0 || tvLoading) && (
              <div style={{ borderTop: "1px solid var(--dos-border)", margin: "4px 0" }} />
            )}

            {/* Tier 2 */}
            {(tvMatches.length > 0 || tvLoading) && (
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", opacity: 0.6, padding: "6px 8px 2px" }}>
                CREATE A NEW FORUM
              </div>
            )}
            {tvLoading && (
              <div className="muted" style={{ fontSize: 12, padding: "4px 8px" }}>Searching…</div>
            )}
            {!tvLoading && tvMatches.map((tv) => (
              <div
                key={tv.id}
                role="option"
                style={{ padding: "6px 8px", cursor: "pointer" }}
                onMouseDown={(e) => { e.preventDefault(); handlePickTVmaze(tv); }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ fontWeight: 600 }}>{tv.name}</span>
                {networkLabel(tv) && (
                  <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>{networkLabel(tv)}</span>
                )}
              </div>
            ))}

            {/* Empty state */}
            {!tvLoading && totalItems === 0 && (
              <div className="muted" style={{ padding: "8px", fontSize: 13 }}>No results found.</div>
            )}
          </div>
        )}
      </div>

      {/* Combined create-forum + watch-status modal */}
      {confirming && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
        }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) resetModal(); }}
        >
          <div className="card" style={{
            background: "var(--dos-bg)", border: "2px solid #fff",
            borderRadius: 24, padding: "24px 28px", maxWidth: 400, width: "92vw",
            display: "flex", flexDirection: "column", gap: 16,
          }}>
            {/* Header */}
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>{confirming.name}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {[confirming.network?.name || confirming.webChannel?.name, confirming.premiered?.slice(0, 4), confirming.status].filter(Boolean).join(" · ")}
              </div>
            </div>

            {/* Watch-status questionnaire */}
            <div>
              <p className="muted" style={{ fontSize: 14, margin: "0 0 10px" }}>
                Are you rewatching <strong>{confirming.name}</strong>, or is this your first time through?
              </p>
              <div style={{ display: "flex", gap: 16 }}>
                {(["first", "rewatch"] as const).map(choice => (
                  <label key={choice} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}>
                    <input
                      type="radio"
                      name="newForumWatchStatus"
                      value={choice}
                      checked={watchChoice === choice}
                      onChange={() => setWatchChoice(choice)}
                      style={{ accentColor: "var(--green)", cursor: "pointer" }}
                    />
                    {choice === "first" ? "First time" : "Rewatching"}
                  </label>
                ))}
              </div>
            </div>

            {/* Episode selects — shown once seasons are loaded */}
            {seasonsLoading && (
              <div className="muted" style={{ fontSize: 13 }}>Loading episode data…</div>
            )}

            {!seasonsLoading && confirmingSeasons && watchChoice === "rewatch" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
                    What's the furthest you watched last time?
                  </label>
                  <EpisodeSelectInline seasons={confirmingSeasons} value={highestSel} onChange={setHighestSel} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
                    How far are you on your rewatch?
                  </label>
                  <EpisodeSelectInline seasons={confirmingSeasons} value={rewatchSel} onChange={setRewatchSel} />
                </div>
              </div>
            )}

            {!seasonsLoading && confirmingSeasons && watchChoice === "first" && (
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
                  How far have you watched?
                </label>
                <EpisodeSelectInline seasons={confirmingSeasons} value={firstTimeSel} onChange={setFirstTimeSel} />
              </div>
            )}

            {createError && (
              <div style={{ color: "var(--danger)", fontSize: 13 }}>{createError}</div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={resetModal} disabled={creating}>
                Cancel
              </button>
              <button className="btn post" onClick={handleConfirmCreate} disabled={!canSubmit}>
                {creating ? "Creating…" : "Create forum"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
