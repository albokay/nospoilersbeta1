import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import type { Show } from "../lib/db";
import { createShow, createFriendGroup } from "../lib/db";
import { useAuth } from "../lib/auth";
import type { ProgressEntry, FriendGroup } from "../types";
import Tooltip from "./Tooltip";

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
  // Network / fetch failure — fall back to a single placeholder season so the
  // picker has something to render. A genuinely unreleased show is handled
  // separately below by returning an empty array.
  if (!res.ok) return [1];
  const episodes: any[] = await res.json();
  const nowIso = new Date().toISOString();
  const bySeason: Record<number, number> = {};
  for (const ep of episodes) {
    const isRegular = ep.type === "regular" || !ep.type;
    // airstamp is an ISO 8601 timestamp with timezone; simple lexicographic
    // compare against now-ISO correctly handles timezone. airdate alone is
    // date-only and would give same-day-premiere users a one-day UX hole.
    const hasAired = typeof ep.airstamp === "string" && ep.airstamp <= nowIso;
    if (isRegular && hasAired) {
      bySeason[ep.season] = (bySeason[ep.season] ?? 0) + 1;
    }
  }
  const seasonKeys = Object.keys(bySeason).map(Number);
  if (!seasonKeys.length) return [];  // no aired episodes — picker should offer only "haven't started"
  const maxSeason = Math.max(...seasonKeys);
  const seasons: number[] = [];
  for (let i = 1; i <= maxSeason; i++) {
    seasons.push(bySeason[i] ?? 0);
  }
  return seasons;
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
  allowZero = false,
  disableAtOrAbove,
  disableAtOrBelow,
}: {
  seasons: number[];
  value: { s: number; e: number };
  onChange: (v: { s: number; e: number }) => void;
  allowZero?: boolean;
  // Rewatch pairing: options that are (s,e) >= this bound are disabled.
  // Used on the rewatch-position selector when highest is set — rewatch
  // must be strictly less than highest.
  disableAtOrAbove?: { s: number; e: number };
  // Options that are (s,e) <= this bound are disabled. Used on the
  // highest selector — highest must be strictly greater than rewatch.
  disableAtOrBelow?: { s: number; e: number };
}) {
  const val = `s${value.s}e${value.e}`;
  const isDisabled = (s: number, e: number) => {
    if (disableAtOrAbove) {
      const a = disableAtOrAbove;
      if (s > a.s || (s === a.s && e >= a.e)) return true;
    }
    if (disableAtOrBelow) {
      const b = disableAtOrBelow;
      if (s < b.s || (s === b.s && e <= b.e)) return true;
    }
    return false;
  };
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
      {allowZero && (
        <option value="s0e0">Haven't started</option>
      )}
      {seasons.map((epCount, idx) => {
        const s = idx + 1;
        const eps = Array.from({ length: epCount }, (_, i) => i + 1);
        return (
          <optgroup key={s} label={`Season ${s}`}>
            {eps.map(e => (
              <option key={e} value={`s${s}e${e}`} disabled={isDisabled(s, e)}>
                Season {s} Episode {e}
              </option>
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
  progress,
  onShowCreated,
  onBrowsePublic,
  onReopenJournal,
  onAuthRequired,
  style,
  placeholder,
}: {
  shows: Show[];
  progress?: Record<string, ProgressEntry>;
  onShowCreated?: (show: Show, entry: ProgressEntry, action: "friendRoom", friendGroup: FriendGroup) => void;
  onBrowsePublic?: (showId: string, showName: string, entry: ProgressEntry, seasons: number[]) => void;
  // Called when the user searches a show they've already onboarded onto
  // (real progress row exists) and no active sessionStorage browse override
  // is set. Takes them back to their journal tab — unhiding it if they had
  // previously closed it — instead of re-running the onboarding modal.
  onReopenJournal?: (showId: string) => void;
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
  // Two-step modal: progress questionnaire → room naming. Step state is
  // local to the modal and resets on close.
  const [step, setStep] = useState<"progress" | "naming">("progress");
  const [roomName, setRoomName] = useState("");

  // Watch-status questionnaire state
  const [watchChoice, setWatchChoice] = useState<"first" | "rewatch" | null>(null);
  const [highestSel, setHighestSel] = useState<{ s: number; e: number }>({ s: 1, e: 1 });
  // Rewatch-position and first-time-progress default to "haven't started"
  // (0,0) so a new user can start a journal / join a friend room before
  // watching anything. allowZero is enabled on both selects so the option
  // is visible and re-selectable. highestSel stays at (1,1) because the
  // rewatch validation requires highest > rewatch, and (1,1) is the
  // minimum allowable highest when rewatch is (0,0).
  const [rewatchSel, setRewatchSel] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [firstTimeSel, setFirstTimeSel] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [progressTouched, setProgressTouched] = useState(false);

  // All results come from TVMaze, with one exception: The Sidebar Protocol
  // is a seeded demo show that doesn't exist on TVmaze. When the user has
  // a TSP progress row (they've been set up with the demo) AND their query
  // matches the title, we inject a synthetic entry so they can find and
  // reopen their TSP tab through the same search flow as real shows.
  const tspMatchesQuery = (q: string) => {
    const n = q.trim().toLowerCase();
    if (!n) return false;
    return (
      "the sidebar protocol".includes(n) ||
      "sidebar protocol".includes(n) ||
      n === "tsp"
    );
  };
  const hasTspProgress = !!progress?.["tsp"];
  const showTspSynthetic = hasTspProgress && tspMatchesQuery(query);

  const tvMatches = useMemo(() => tvResults.slice(0, 8), [tvResults]);

  // Debounced TVmaze fetch
  useEffect(() => {
    const q = query.trim();
    if (!q) { setTvResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setTvLoading(true);
      try {
        const results = await tvmazeSearch(q);
        if (cancelled) return;
        setTvResults(results);
      } catch { if (!cancelled) setTvResults([]); }
      finally { if (!cancelled) setTvLoading(false); }
    }, 320);
    return () => { cancelled = true; if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const resetModal = () => {
    setConfirming(null);
    setConfirmingSeasons(null);
    setCreateError(null);
    setWatchChoice(null);
    setHighestSel({ s: 1, e: 1 });
    setRewatchSel({ s: 0, e: 0 });
    setFirstTimeSel({ s: 0, e: 0 });
    setProgressTouched(false);
    setStep("progress");
    setRoomName("");
  };

  // No auth gate — anyone can open the onboarding modal
  const handlePickTVmaze = async (tv: TVmazeShow) => {
    const showId = slugify(tv.name);
    setOpen(false);

    // Skip the modal for users who've already onboarded onto this show
    // (real progress row in DB). NOTE: checking the `shows` array is wrong —
    // App.onBrowsePublic adds shows optimistically, so `shows` contains
    // entries even for browse-only sessions. progress[showId] is only set
    // when onboarding completed (journal / friend room).
    const hasJournalTab = !!progress?.[showId];
    if (hasJournalTab) {
      // Preserve "see public conversations" intent: if they opted into the
      // public show space this session, keep them there instead of yanking
      // back to the journal.
      try {
        const existing = JSON.parse(sessionStorage.getItem(`ns_browse_prog_${showId}`) || "null");
        if (existing) {
          const storedShow = JSON.parse(sessionStorage.getItem(`ns_browse_show_${showId}`) || "null");
          const seasons = storedShow?.seasons ?? shows.find(s => s.id === showId)?.seasons ?? [1];
          setQuery(tv.name);
          onBrowsePublic?.(showId, tv.name, existing, seasons);
          return;
        }
      } catch {}
      // Otherwise: go back to their journal tab. The user may have closed
      // the tab previously; ProfilePage auto-unhides when navigated to via
      // activeTab state. Their saved progress is preserved — no re-onboarding.
      if (onReopenJournal) {
        setQuery(tv.name);
        onReopenJournal(showId);
        return;
      }
    }

    setConfirming(tv);
    setConfirmingSeasons(null);
    setCreateError(null);

    // Session pre-pop: if the user already filled out this modal earlier in
    // the session (and exited via "See public conversations"), restore their
    // prior selection instead of resetting. Cancel paths leave nothing in
    // sessionStorage, so a cancel won't trigger pre-pop.
    let prior: ProgressEntry | null = null;
    try {
      prior = JSON.parse(sessionStorage.getItem(`ns_browse_prog_${showId}`) || "null");
    } catch {}
    if (prior && prior.isRewatching && prior.highestS != null && prior.highestE != null) {
      setWatchChoice("rewatch");
      setRewatchSel({ s: prior.rewatchS ?? prior.s, e: prior.rewatchE ?? prior.e });
      setHighestSel({ s: prior.highestS, e: prior.highestE });
      setProgressTouched(true);
    } else if (prior && !prior.isRewatching) {
      setWatchChoice("first");
      setFirstTimeSel({ s: prior.s, e: prior.e });
      setProgressTouched(true);
    } else {
      setWatchChoice(null);
      setHighestSel({ s: 1, e: 1 });
      setRewatchSel({ s: 0, e: 0 });
      setFirstTimeSel({ s: 0, e: 0 });
    }

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

  // Step-1 advance: validate progress, require auth, move to room-naming step.
  // The actual show + room creation happens in handleCreateRoom on step 2.
  const handleAdvanceToNaming = () => {
    if (!user) { onAuthRequired?.(); return; }
    const entry = buildEntry();
    if (!confirming || !entry) return;
    setStep("naming");
  };

  // Step-2 submit: create the show, create the friend room, then notify
  // App which sets progress + navigates the user into the new room.
  const handleCreateRoom = async () => {
    if (!user) { onAuthRequired?.(); return; }
    const entry = buildEntry();
    if (!confirming || !entry) return;
    if (!roomName.trim()) return;
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
      const group = await createFriendGroup({
        showId: newShow.id, name: roomName.trim(), createdBy: user.id,
      });
      setQuery(newShow.name);
      resetModal();
      onShowCreated?.(newShow, entry, "friendRoom", group);
    } catch (e: any) {
      setCreateError(e?.message ?? "Something went wrong. Try again.");
    } finally {
      setCreating(false);
    }
  };

  // Rewatch must be strictly less than highest — required for the rewatch
  // post-tagging model (posts tag at highest, display the rewatch pair).
  const rewatchValid =
    watchChoice !== "rewatch" ||
    highestSel.s > rewatchSel.s ||
    (highestSel.s === rewatchSel.s && highestSel.e > rewatchSel.e);
  const canSubmit = !!watchChoice && !seasonsLoading && !creating && rewatchValid;

  return (
    <>
      <div className="splashSearchWrap" style={style}>
        <span className="splashSearchIcon" aria-hidden><Search size={14} color="currentColor" /></span>
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
            {/* Synthetic TSP match pinned at the top when applicable — the
               demo show doesn't live on TVmaze, so we surface it here and
               route straight to onReopenJournal, bypassing the real-show
               onboarding flow entirely. */}
            {showTspSynthetic && (
              <div
                key="tsp-synthetic"
                role="option"
                style={{ padding: "6px 8px", cursor: "pointer" }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery("The Sidebar Protocol");
                  setOpen(false);
                  if (onReopenJournal) onReopenJournal("tsp");
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ fontWeight: 600 }}>The Sidebar Protocol</span>
                <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>demo</span>
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

            {/* Empty state — only when nothing else is on offer */}
            {!tvLoading && tvMatches.length === 0 && !showTspSynthetic && (
              <div className="muted" style={{ padding: "8px", fontSize: 13 }}>No results found.</div>
            )}
          </div>
        )}
      </div>

      {/* ── Onboarding modal ─────────────────────────────────────────────── */}
      {/* Portaled to document.body so it escapes `.topHeaderWrap`'s
          `pointer-events: none` rule — the modal contains custom <div>
          click targets (radios, backdrop) that aren't in the allowlist. */}
      {confirming && createPortal(
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

            {/* Step 1: progress questionnaire + episode picker */}
            {step === "progress" && (
              <>
                <div>
                  <p className="muted" style={{ fontSize: 14, margin: "0 0 10px" }}>
                    Are you rewatching <strong>{confirming.name}</strong>, or is this your first time through?
                  </p>
                  <div style={{ display: "flex", gap: 16 }}>
                    {(["first", "rewatch"] as const).map(choice => {
                      const row = (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }} onClick={() => setWatchChoice(choice)}>
                          <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, border: "none", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {watchChoice === choice && <div className="radio-dot" style={{ width: 10, height: 10, borderRadius: "50%", background: "#7abd8e" }} />}
                          </div>
                          {choice === "first" ? "First time" : "Rewatching"}
                        </div>
                      );
                      if (choice === "rewatch") {
                        return (
                          <Tooltip
                            key={choice}
                            text="You've seen the show before? Pick this. Your posts will be filtered to protect first-time viewers from anything you might give away."
                            direction="above"
                            align="center"
                            portal
                            width={260}
                          >
                            {row}
                          </Tooltip>
                        );
                      }
                      return <React.Fragment key={choice}>{row}</React.Fragment>;
                    })}
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
                      <EpisodeSelectInline
                        seasons={confirmingSeasons}
                        value={highestSel}
                        onChange={(v) => { setHighestSel(v); setProgressTouched(true); }}
                        // Highest must be strictly greater than rewatch position.
                        disableAtOrBelow={progressTouched ? rewatchSel : undefined}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
                        How far are you on your rewatch?
                      </label>
                      <EpisodeSelectInline
                        seasons={confirmingSeasons}
                        value={rewatchSel}
                        onChange={(v) => { setRewatchSel(v); setProgressTouched(true); }}
                        // Rewatch must be strictly less than highest.
                        disableAtOrAbove={progressTouched ? highestSel : undefined}
                        allowZero
                      />
                    </div>
                  </div>
                )}

                {!seasonsLoading && confirmingSeasons && watchChoice === "first" && (
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
                      How far have you watched?
                    </label>
                    <EpisodeSelectInline seasons={confirmingSeasons} value={firstTimeSel} onChange={(v) => { setFirstTimeSel(v); setProgressTouched(true); }} allowZero />
                  </div>
                )}

                {/* Step-1 buttons: advance to room-naming, or cancel */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                  <button className="btn post" onClick={handleAdvanceToNaming} disabled={!canSubmit} style={{ width: "100%", background: "#dea838", borderColor: "#dea838", color: "#fff", opacity: canSubmit ? 1 : 0.4 }}>
                    Start a friend room
                  </button>
                  <button className="btn" onClick={resetModal} style={{ width: "100%", opacity: 0.7 }}>
                    Cancel
                  </button>
                </div>
              </>
            )}

            {/* Step 2: room naming + new copy */}
            {step === "naming" && (
              <>
                <div>
                  <h3 className="title" style={{ margin: "0 0 8px", fontSize: 16 }}>Create a friend room</h3>
                  <p style={{ margin: "0 0 12px", fontSize: 14, opacity: 0.85, lineHeight: 1.5 }}>
                    This will be where you and your friends talk about <strong>{confirming.name}</strong>. Whatever anyone writes here will only be visible to you and your friends. You can decide who to invite later.
                  </p>
                </div>
                <input
                  className="badge"
                  placeholder="give your room a unique name"
                  value={roomName}
                  onChange={e => setRoomName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && roomName.trim() && !creating) handleCreateRoom(); }}
                  style={{ width: "100%", height: 40 }}
                  autoFocus
                />

                {createError && (
                  <div style={{ color: "var(--danger)", fontSize: 13 }}>{createError}</div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                  <button className="btn post" onClick={handleCreateRoom} disabled={creating || !roomName.trim()} style={{ width: "100%", background: "#dea838", borderColor: "#dea838", color: "#fff", opacity: (creating || !roomName.trim()) ? 0.4 : 1 }}>
                    {creating ? "Creating…" : "Create room"}
                  </button>
                  <button className="btn" onClick={resetModal} disabled={creating} style={{ width: "100%", opacity: 0.7 }}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
