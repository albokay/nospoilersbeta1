import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import type { Show } from "../lib/db";
import { createShow } from "../lib/db";
import { useAuth } from "../lib/auth";

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

// ── Component ──────────────────────────────────────────────────────────────

export default function SearchShows({ shows, onPick, onShowCreated, onAuthRequired, style }: {
  shows: Show[];
  onPick: (showId: string) => void;
  onShowCreated?: (show: Show) => void;
  onAuthRequired?: () => void;
  style?: React.CSSProperties;
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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Tier 1: existing shows on Sidebar (not hidden)
  const localMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shows.filter(s => !s.isHidden && s.name.toLowerCase().includes(q));
  }, [query, shows]);

  // IDs already on Sidebar (for dedup)
  const existingTvmazeIds = useMemo(() =>
    new Set(shows.map(s => s.tvmazeId).filter(Boolean) as string[]),
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

  const handlePickLocal = (show: Show) => {
    onPick(show.id);
    setQuery(show.name);
    setOpen(false);
  };

  const handlePickTVmaze = (tv: TVmazeShow) => {
    if (!user) {
      setOpen(false);
      onAuthRequired?.();
      return;
    }
    setConfirming(tv);
    setOpen(false);
    setCreateError(null);
  };

  const handleConfirmCreate = async () => {
    if (!confirming) return;
    setCreating(true);
    setCreateError(null);
    try {
      const seasons = await tvmazeEpisodes(confirming.id);
      const id = slugify(confirming.name);
      const newShow = await createShow({
        id,
        name: confirming.name,
        seasons,
        tvmazeId: String(confirming.id),
        status: confirming.status === "Running" ? "Running" : "Ended",
      });
      onShowCreated?.(newShow);
      setQuery(newShow.name);
      setConfirming(null);
      onPick(newShow.id);
    } catch (e: any) {
      setCreateError(e?.message ?? "Failed to create forum. Try again.");
    } finally {
      setCreating(false);
    }
  };

  const totalItems = localMatches.length + tvMatches.length;

  return (
    <>
      <div className="splashSearchWrap" style={style}>
        <span className="splashSearchIcon" aria-hidden>🔍</span>
        <input
          placeholder="find a show"
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

      {/* Confirmation modal */}
      {confirming && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
        }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setConfirming(null); setCreateError(null); } }}
        >
          <div className="card" style={{
            background: "rgba(201,168,67,0.98)", border: "3px solid #fff",
            borderRadius: 24, padding: "24px 28px", maxWidth: 380, width: "92vw",
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>{confirming.name}</div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              {[confirming.network?.name || confirming.webChannel?.name, confirming.premiered?.slice(0, 4), confirming.status].filter(Boolean).join(" · ")}
            </div>
            <div style={{ marginBottom: 20, fontSize: 14 }}>
              Create a new forum for <b>{confirming.name}</b> on Sidebar?
            </div>
            {createError && (
              <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{createError}</div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => { setConfirming(null); setCreateError(null); }}>
                Cancel
              </button>
              <button className="btn post" onClick={handleConfirmCreate} disabled={creating}>
                {creating ? "Creating…" : "Create forum"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
