import React, { useState, useMemo, useEffect, useRef } from "react";
import type { Show } from "../lib/db";
import { createShow, upsertBrowseProgress } from "../lib/db";
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

export default function SearchShows({
  shows,
  onShowCreated,
  onBrowsePublic,
  onAuthRequired,
  style,
  placeholder,
}: {
  shows: Show[];
  onShowCreated?: (show: Show, entry: ProgressEntry, action: "journal" | "friendRoom") => void;
  onBrowsePublic?: (showId: string, showName: string, entry: ProgressEntry, seasons: number[]) => void;
  onAuthRequired?: () => void;
  style?: React.CSSProperties;
  placeholder?: string;
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // TVmaze async results
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [tvLoading, setTvLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Onboarding modal state
  const [confirming, setConfirming] = useState<TVmazeShow | null>(null);
  const [confirmingSeasons, setConfirmingSeasons] = useState<number[] | null>(null);
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Watch-status questionnaire state
  const [watchChoice, setWatchChoice] = useState<"first" | "rewatch" | null>(null);
  const [highestSel, setHighestSel] = useState<{ s: number; e: number }>({ s: 1, e: 1 });
  const [rewatchSel, setRewatchSel] = useState<{ s: number; e: number }>({ s: 1, e: 1 });
  const [firstTimeSel, setFirstTimeSel] = useState<{ s: number; e: number }>({ s: 1, e: 1 });

  // All results come from TVMaze — no local filtering, no "already on sidebar"
  const tvMatches = useMemo(() => tvResults.slice(0, 8), [tvResults]);

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

  // No auth gate — anyone can open the onboarding modal
  const handlePickTVmaze = async (tv: TVmazeShow) => {
    const showId = slugify(tv.name);
    setOpen(false);

    // If browse progress already exists this session, skip the modal
    // and go straight to the public space
    try {
      const existing = JSON.parse(sessionStorage.getItem(`ns_browse_prog_${showId}`) || "null");
      if (existing) {
        const storedShow = JSON.parse(sessionStorage.getItem(`ns_browse_show_${showId}`) || "null");
        const seasons = storedShow?.seasons ?? [1];
        setQuery(tv.name);
        onBrowsePublic?.(showId, tv.name, existing, seasons);
        return;
      }
    } catch {}

    setConfirming(tv);
    setConfirmingSeasons(null);
    setCreateError(null);
    setWatchChoice(null);
    setHighestSel({ s: 1, e: 1 });
    setRewatchSel({ s: 1, e: 1 });
    setFirstTimeSel({ s: 1, e: 1 });
    // Fetch episode data so the selects are ready
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

  // Build ProgressEntry from the questionnaire answers
  const buildEntry = (): ProgressEntry | null => {
    if (!watchChoice) return null;
    if (watchChoice === "rewatch") {
      return {
        s: rewatchSel.s, e: rewatchSel.e,
        isRewatching: true,
        rewatchS: rewatchSel.s, rewatchE: rewatchSel.e,
        highestS: highestSel.s, highestE: highestSel.e,
      };
    }
    return { s: firstTimeSel.s, e: firstTimeSel.e, isRewatching: false };
  };

  // ── Action handlers ────────────────────────────────────────────────────

  const handleCreateFriendRoom = async () => {
    if (!user) { onAuthRequired?.(); return; }
    const entry = buildEntry();
    if (!confirming || !entry) return;
    setCreating(true);
    setCreateError(null);
    try {
      const seasons = confirmingSeasons ?? [1];
      const id = slugify(confirming.name);
      const newShow = await createShow({
        id, name: confirming.name, seasons,
        tvmazeId: String(confirming.id),
        status: confirming.status === "Running" ? "Running" : "Ended",
      });
      setQuery(newShow.name);
      resetModal();
      onShowCreated?.(newShow, entry, "friendRoom");
    } catch (e: any) {
      setCreateError(e?.message ?? "Something went wrong. Try again.");
    } finally {
      setCreating(false);
    }
  };

  const handleStartJournal = async () => {
    if (!user) { onAuthRequired?.(); return; }
    const entry = buildEntry();
    if (!confirming || !entry) return;
    setCreating(true);
    setCreateError(null);
    try {
      const seasons = confirmingSeasons ?? [1];
      const id = slugify(confirming.name);
      const newShow = await createShow({
        id, name: confirming.name, seasons,
        tvmazeId: String(confirming.id),
        status: confirming.status === "Running" ? "Running" : "Ended",
      });
      setQuery(newShow.name);
      resetModal();
      onShowCreated?.(newShow, entry, "journal");
    } catch (e: any) {
      setCreateError(e?.message ?? "Something went wrong. Try again.");
    } finally {
      setCreating(false);
    }
  };

  const handleSeePublic = async () => {
    const entry = buildEntry();
    if (!confirming || !entry) return;
    const seasons = confirmingSeasons ?? [1];
    const showId = slugify(confirming.name);

    // Always store in sessionStorage for immediate availability on navigation
    sessionStorage.setItem(`ns_browse_prog_${showId}`, JSON.stringify(entry));

    // Also persist to DB for logged-in users (for cross-session pre-population)
    if (user) {
      const existingShow = shows.find(s => s.tvmazeId === String(confirming.id) || s.id === showId);
      if (existingShow) {
        upsertBrowseProgress(user.id, existingShow.id, entry).catch(() => {});
      }
    }

    // Store show metadata so ShowSection can render correctly even without a shows row
    sessionStorage.setItem(`ns_browse_show_${showId}`, JSON.stringify({
      name: confirming.name, seasons,
    }));

    setQuery(confirming.name);
    resetModal();
    onBrowsePublic?.(showId, confirming.name, entry, seasons);
  };

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
            {!tvLoading && tvMatches.length === 0 && (
              <div className="muted" style={{ padding: "8px", fontSize: 13 }}>No results found.</div>
            )}
          </div>
        )}
      </div>

      {/* ── Onboarding modal ─────────────────────────────────────────────── */}
      {confirming && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
        }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) resetModal(); }}
        >
          <div className="card" style={{
            background: "var(--dos-bg)", border: "none",
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
                  <div key={choice} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }} onClick={() => setWatchChoice(choice)}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, border: "none", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {watchChoice === choice && <div className="radio-dot" style={{ width: 10, height: 10, borderRadius: "50%", background: "#7abd8e" }} />}
                    </div>
                    {choice === "first" ? "First time" : "Rewatching"}
                  </div>
                ))}
              </div>
            </div>

            {/* Episode selects */}
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

            {/* Four action buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              <button className="btn post" onClick={handleStartJournal} disabled={!canSubmit} style={{ width: "100%", background: "#dea838", borderColor: "#dea838", color: "#fff" }}>
                Start your journal
              </button>
              <button className="btn post" onClick={handleCreateFriendRoom} disabled={!canSubmit} style={{ width: "100%", background: "#dea838", borderColor: "#dea838", color: "#fff" }}>
                Create a friend room
              </button>
              <button className="btn" onClick={handleSeePublic} disabled={!canSubmit} style={{ width: "100%" }}>
                See public conversations
              </button>
              <button className="btn" onClick={resetModal} disabled={creating} style={{ width: "100%", opacity: 0.7 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
