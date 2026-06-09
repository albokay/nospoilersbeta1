import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../lib/auth";
import {
  createShow,
  upsertRewatchStatus,
  setCanonPin,
  setShelfBlurb,
  setShelfOverride,
  insertProfileThought,
} from "../../lib/db";
import type { ProgressEntry } from "../../types";
import {
  tvmazeSearch,
  tvmazeEpisodes,
  networkLabel,
  slugify,
  type TVmazeShow,
} from "../../lib/tvmaze";
import EpisodeSelectInline from "../EpisodeSelectInline";
import ProfileThoughtsCompose, { type ProfileThoughtsSubmitPayload } from "./ProfileThoughtsCompose";
import Tooltip from "../Tooltip";

// ── Cream/ink palette (mirrors ComposeModal + ProfileThoughtsCompose) ───────
const CREAM_BG = "#fef8ea";
const INK = "#2b2418";
const INK_SOFT = "#5a4d3a";
const INK_FAINT = "#8a7860";
const RULE = "rgba(43, 36, 24, 0.32)";
const ACCENT = "#355eb8"; // canon blue, for the primary "confirm" action

// ── Shared debounced TVMaze search hook ─────────────────────────────────────
function useTvSearch(query: string) {
  const [results, setResults] = useState<TVmazeShow[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await tvmazeSearch(q);
        if (!cancelled) setResults(r.slice(0, 8));
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 320);
    return () => { cancelled = true; if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);
  return { results, loading };
}

// ── A cream-surface show search field (search portion only) ─────────────────
function ShowSearchField({
  placeholder,
  onPick,
}: {
  placeholder: string;
  onPick: (tv: TVmazeShow) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { results, loading } = useTvSearch(query);
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        value={query}
        placeholder={placeholder}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        style={{
          width: "100%",
          background: "#fff",
          color: INK,
          border: `2px solid ${RULE}`,
          borderRadius: 0,
          padding: "10px 12px",
          fontFamily: "Inter, sans-serif",
          fontSize: 15,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      {open && !!query.trim() && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#fff",
            border: `2px solid ${RULE}`,
            zIndex: 20,
            maxHeight: 260,
            overflowY: "auto",
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
          }}
        >
          {loading && (
            <div style={{ padding: "8px 10px", fontSize: 13, color: INK_FAINT }}>Searching…</div>
          )}
          {!loading && results.map((tv) => (
            <div
              key={tv.id}
              role="option"
              onMouseDown={(e) => { e.preventDefault(); onPick(tv); setQuery(tv.name); setOpen(false); }}
              style={{ padding: "8px 10px", cursor: "pointer", color: INK }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(43,36,24,0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ fontWeight: 600 }}>{tv.name}</span>
              {networkLabel(tv) && (
                <span style={{ fontSize: 12, marginLeft: 6, color: INK_FAINT }}>{networkLabel(tv)}</span>
              )}
            </div>
          ))}
          {!loading && results.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: 13, color: INK_FAINT }}>No results found.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Canon page selection model ──────────────────────────────────────────────
type CanonSelection = { tv: TVmazeShow; seasons: number[] | null; blurb: string };

function CanonRow({
  index,
  onChange,
}: {
  index: number;
  onChange: (i: number, sel: CanonSelection | null) => void;
}) {
  const [selected, setSelected] = useState<TVmazeShow | null>(null);
  const [seasons, setSeasons] = useState<number[] | null>(null);
  const [blurb, setBlurb] = useState("");

  // Emit upward without putting the parent's (unstable) callback in deps.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current(index, selected ? { tv: selected, seasons, blurb } : null);
  }, [selected, seasons, blurb, index]);

  async function pick(tv: TVmazeShow) {
    setSelected(tv);
    setSeasons(null);
    try {
      const s = await tvmazeEpisodes(tv.id);
      setSeasons(s.length ? s : [1]);
    } catch {
      setSeasons([1]);
    }
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 240px", minWidth: 200 }}>
        {selected ? (
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
              background: "#fff", border: `2px solid ${RULE}`, padding: "10px 12px",
              boxSizing: "border-box", minHeight: 46,
            }}
          >
            <span style={{ fontWeight: 600, color: INK, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selected.name}
            </span>
            <button
              onClick={() => { setSelected(null); setSeasons(null); setBlurb(""); }}
              title="choose a different show"
              style={{ background: "transparent", border: "none", color: INK_FAINT, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 4 }}
            >
              ×
            </button>
          </div>
        ) : (
          <ShowSearchField placeholder="find a show" onPick={pick} />
        )}
      </div>
      <div style={{ flex: "1 1 220px", minWidth: 180 }}>
        <input
          value={blurb}
          disabled={!selected}
          placeholder={selected ? "why it's great (optional)" : ""}
          onChange={(e) => setBlurb(e.target.value.slice(0, 280))}
          style={{
            width: "100%",
            background: selected ? "#fff" : "rgba(43,36,24,0.04)",
            color: INK,
            border: `2px solid ${RULE}`,
            borderRadius: 0,
            padding: "10px 12px",
            fontFamily: "Inter, sans-serif",
            fontSize: 15,
            outline: "none",
            boxSizing: "border-box",
            opacity: selected ? 1 : 0.5,
          }}
        />
      </div>
    </div>
  );
}

// ── Watch-status radio ──────────────────────────────────────────────────────
function WatchRadio({
  selected,
  label,
  onSelect,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 15, color: INK }}
    >
      <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, border: `2px solid ${INK}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {selected && <div style={{ width: 10, height: 10, borderRadius: "50%", background: ACCENT }} />}
      </div>
      {label}
    </div>
  );
}

// ── Bottom-bar page dots ────────────────────────────────────────────────────
function PageDots({ page, total }: { page: number; total: number }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            height: 8,
            width: i === page ? 22 : 8,
            borderRadius: 9999,
            background: i === page ? INK : "rgba(43,36,24,0.25)",
            transition: "width 220ms ease, background 220ms ease",
          }}
        />
      ))}
    </div>
  );
}

// ── The modal ────────────────────────────────────────────────────────────────
// Forward-only, three pages: Canon → Thoughts → Watching-now. Advancing (by
// Confirm or "Not now") locks the page; there is no back/forward navigation.
// After page 3 advances, onComplete fires (parent stamps onboarded_at, refreshes
// data, and runs the reveal).
export default function OnboardingModal({
  onComplete,
  onRevealStart,
}: {
  // Runs while the modal is STILL fully visible: the parent stamps onboarded_at
  // and refetches/applies profile data so the frame behind is at final layout
  // before the modal fades (kills the post-close pop-in). Awaited.
  onComplete: () => void | Promise<void>;
  // Fired AFTER the fade-out completes: the parent unmounts the modal and
  // starts the beat sequence.
  onRevealStart?: () => void;
}) {
  const { user } = useAuth();
  const [page, setPage] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  // Canon page
  const [canonRows, setCanonRows] = useState<(CanonSelection | null)[]>([null, null, null]);
  const handleCanonRowChange = (i: number, sel: CanonSelection | null) =>
    setCanonRows((prev) => { const n = [...prev]; n[i] = sel; return n; });
  const canonHasSelection = canonRows.some(Boolean);

  // Watching-now page
  const [watchingSelected, setWatchingSelected] = useState<TVmazeShow | null>(null);
  const [watchingSeasons, setWatchingSeasons] = useState<number[] | null>(null);
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [watchChoice, setWatchChoice] = useState<"first" | "rewatch" | null>(null);
  const [highestSel, setHighestSel] = useState<{ s: number; e: number }>({ s: 1, e: 1 });
  const [rewatchSel, setRewatchSel] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [firstTimeSel, setFirstTimeSel] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [progressTouched, setProgressTouched] = useState(false);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  function advance() {
    setError(null);
    if (page < 2) setPage((p) => (p + 1) as 0 | 1 | 2);
    else finishFlow();
  }

  // Last page advanced. Finalize (writes + data refetch) while the modal is
  // STILL visible so the frame behind reaches final layout, THEN fade the modal
  // out, THEN hand off to the reveal beats.
  async function finishFlow() {
    if (closing) return;
    setBusy(true);
    try { await onComplete(); } catch (e) { console.warn("onboarding finalize failed:", e); }
    setClosing(true);
    window.setTimeout(() => onRevealStart?.(), 450);
  }

  async function pickWatching(tv: TVmazeShow) {
    setWatchingSelected(tv);
    setWatchingSeasons(null);
    setWatchChoice(null);
    setHighestSel({ s: 1, e: 1 });
    setRewatchSel({ s: 0, e: 0 });
    setFirstTimeSel({ s: 0, e: 0 });
    setProgressTouched(false);
    setSeasonsLoading(true);
    try {
      const s = await tvmazeEpisodes(tv.id);
      setWatchingSeasons(s.length ? s : [1]);
    } catch {
      setWatchingSeasons([1]);
    } finally {
      setSeasonsLoading(false);
    }
  }

  function buildWatchingEntry(): ProgressEntry | null {
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
  }

  const rewatchValid =
    watchChoice !== "rewatch" ||
    highestSel.s > rewatchSel.s ||
    (highestSel.s === rewatchSel.s && highestSel.e > rewatchSel.e);

  // ── Confirm handlers ──────────────────────────────────────────────────────
  async function confirmCanon() {
    if (!user || !canonHasSelection) return;
    setBusy(true);
    setError(null);
    try {
      for (const sel of canonRows) {
        if (!sel) continue;
        const seasons = sel.seasons && sel.seasons.length ? sel.seasons : [1];
        const id = slugify(sel.tv.name);
        const show = await createShow({
          id,
          name: sel.tv.name,
          seasons,
          tvmazeId: String(sel.tv.id),
          status: sel.tv.status === "Running" ? "Running" : "Ended",
        });
        // Canon = finished + pinned. Progress at the latest available episode
        // (final season / last aired episode) makes classifyShow resolve to
        // "finished"; the pin elevates it to canon. No shelf_override — natural
        // progress-derived classification (lets the future canon-show-lifecycle
        // spec move it off "finished" when new episodes air).
        const finalS = seasons.length;
        const finalE = seasons[finalS - 1] || 1;
        await upsertRewatchStatus(user.id, show.id, { s: finalS, e: finalE, isRewatching: false });
        await setCanonPin(user.id, show.id, true);
        const blurb = sel.blurb.trim();
        if (blurb) {
          try { await setShelfBlurb(user.id, show.id, "canon_take", blurb); } catch { /* best-effort */ }
        }
      }
      advance();
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmWatching() {
    if (!user || !watchingSelected) return;
    const entry = buildWatchingEntry();
    if (!entry || !rewatchValid) return;
    setBusy(true);
    setError(null);
    try {
      const seasons = watchingSeasons && watchingSeasons.length ? watchingSeasons : [1];
      const id = slugify(watchingSelected.name);
      const show = await createShow({
        id,
        name: watchingSelected.name,
        seasons,
        tvmazeId: String(watchingSelected.id),
        status: watchingSelected.status === "Running" ? "Running" : "Ended",
      });
      await upsertRewatchStatus(user.id, show.id, entry);
      // Pin to the watching-now shelf explicitly (spec §8.4 "placed on the
      // watching-now shelf") so the card deterministically lands there for the
      // reveal regardless of the picked progress.
      try { await setShelfOverride(user.id, show.id, "watching"); } catch { /* best-effort */ }
      advance();
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Thoughts page submit (both private + public allowed). insert → advance.
  async function submitThought(payload: ProfileThoughtsSubmitPayload) {
    if (!user) return;
    await insertProfileThought({
      authorId: user.id,
      titleCompletion: payload.titleCompletion,
      body: payload.body,
      isPublic: payload.isPublic,
    });
  }

  const HEADINGS = [
    'Shows that exemplify "good TV" for you.',
    "Share a thought to start your profile.",
    "What are you watching now?",
  ];
  const SUBHEADINGS = [
    "Pick up to three. They'll be pinned to your profile as canon.",
    "It becomes the first thing people see on your profile — or keep it private, just for you.",
    "Just the show and where you are. You can start a friend room for it later.",
  ];

  if (!user) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.2)",
        zIndex: 10000,
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: closing ? 0 : 1,
        pointerEvents: closing ? "none" : undefined,
        transition: "opacity 450ms ease",
      }}
    >
      <style>{`
        @keyframes ob-page-in {
          from { opacity: 0; transform: translateX(28px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .ob-page { animation: ob-page-in 320ms cubic-bezier(0.22, 1, 0.36, 1); }
      `}</style>
      <div
        style={{
          position: "relative",
          width: "88vw",
          height: "90vh",
          background: CREAM_BG,
          color: INK,
          borderRadius: 24,
          boxShadow: "0 16px 60px rgba(0,0,0,0.28)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Scrollable page body — small, centered content in a lot of space. */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", justifyContent: "center" }}>
          <div
            key={page}
            className="ob-page"
            style={{
              width: "min(620px, 92%)",
              padding: "64px 0 40px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <h2
              style={{
                fontFamily: "Lora, Georgia, serif",
                fontWeight: 600,
                fontSize: 30,
                lineHeight: 1.25,
                color: INK,
                margin: "0 0 10px",
                textAlign: "center",
              }}
            >
              {HEADINGS[page]}
            </h2>
            <p style={{ fontFamily: "Inter, sans-serif", fontSize: 15, color: INK_SOFT, textAlign: "center", margin: "0 0 36px", lineHeight: 1.5 }}>
              {SUBHEADINGS[page]}
            </p>

            {/* ── Page 0: Canon ─────────────────────────────────────────── */}
            {page === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {[0, 1, 2].map((i) => (
                  <CanonRow key={i} index={i} onChange={handleCanonRowChange} />
                ))}
              </div>
            )}

            {/* ── Page 1: Thoughts ──────────────────────────────────────── */}
            {page === 1 && (
              <ProfileThoughtsCompose
                mode="create"
                inline
                creamSurface
                initialContent={null}
                onSubmit={submitThought}
                onClose={advance}
              />
            )}

            {/* ── Page 2: Watching-now ──────────────────────────────────── */}
            {page === 2 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {watchingSelected ? (
                  <div
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                      background: "#fff", border: `2px solid ${RULE}`, padding: "12px 14px",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: INK, fontSize: 16 }}>{watchingSelected.name}</span>
                    <button
                      onClick={() => { setWatchingSelected(null); setWatchingSeasons(null); setWatchChoice(null); }}
                      style={{ background: "transparent", border: "none", color: INK_FAINT, cursor: "pointer", fontSize: 16, padding: 4 }}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <ShowSearchField placeholder="find a show" onPick={pickWatching} />
                )}

                {watchingSelected && (
                  <>
                    <div>
                      <p style={{ fontSize: 14, color: INK_SOFT, margin: "0 0 10px" }}>
                        Are you rewatching <strong>{watchingSelected.name}</strong>, or is this your first time through?
                      </p>
                      <div style={{ display: "flex", gap: 24 }}>
                        <WatchRadio selected={watchChoice === "first"} label="First time" onSelect={() => setWatchChoice("first")} />
                        <Tooltip
                          text="You've seen the show before? Pick this. Your posts will be filtered to protect first-time viewers from anything you might give away."
                          direction="above"
                          align="center"
                          portal
                          width={260}
                        >
                          <WatchRadio selected={watchChoice === "rewatch"} label="Rewatching" onSelect={() => setWatchChoice("rewatch")} />
                        </Tooltip>
                      </div>
                    </div>

                    {seasonsLoading && <div style={{ fontSize: 13, color: INK_FAINT }}>Loading episode data…</div>}

                    {!seasonsLoading && watchingSeasons && watchChoice === "rewatch" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <div>
                          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4, color: INK }}>
                            What's the furthest you watched last time?
                          </label>
                          <EpisodeSelectInline
                            seasons={watchingSeasons}
                            value={highestSel}
                            onChange={(v) => { setHighestSel(v); setProgressTouched(true); }}
                            disableAtOrBelow={progressTouched ? rewatchSel : undefined}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4, color: INK }}>
                            How far are you on your rewatch?
                          </label>
                          <EpisodeSelectInline
                            seasons={watchingSeasons}
                            value={rewatchSel}
                            onChange={(v) => { setRewatchSel(v); setProgressTouched(true); }}
                            disableAtOrAbove={progressTouched ? highestSel : undefined}
                            allowZero
                          />
                        </div>
                      </div>
                    )}

                    {!seasonsLoading && watchingSeasons && watchChoice === "first" && (
                      <div>
                        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4, color: INK }}>
                          How far have you watched?
                        </label>
                        <EpisodeSelectInline
                          seasons={watchingSeasons}
                          value={firstTimeSel}
                          onChange={(v) => { setFirstTimeSel(v); setProgressTouched(true); }}
                          allowZero
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {error && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 16, textAlign: "center" }}>{error}</div>}
          </div>
        </div>

        {/* ── Bottom bar: dots (center) + Not-now/Confirm (right) ──────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            padding: "16px 28px",
            borderTop: `1px solid ${RULE}`,
            background: CREAM_BG,
          }}
        >
          <div />
          <PageDots page={page} total={3} />
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
            <Tooltip text="you can do this later." direction="above" align="center" portal>
              <button
                onClick={advance}
                disabled={busy}
                style={{
                  background: "transparent",
                  border: `2px solid ${RULE}`,
                  color: INK_SOFT,
                  borderRadius: 9999,
                  padding: "9px 18px",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                not now
              </button>
            </Tooltip>

            {/* Page 1 (thoughts) has no Confirm here — the compose's own
                post buttons advance. Pages 0 + 2 get a Confirm. */}
            {page === 0 && (
              <button
                onClick={confirmCanon}
                disabled={busy || !canonHasSelection}
                style={confirmStyle(busy || !canonHasSelection)}
              >
                {busy ? "Saving…" : "Confirm"}
              </button>
            )}
            {page === 2 && (
              <button
                onClick={confirmWatching}
                disabled={busy || !watchingSelected || !watchChoice || !rewatchValid}
                style={confirmStyle(busy || !watchingSelected || !watchChoice || !rewatchValid)}
              >
                {busy ? "Saving…" : "Confirm"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function confirmStyle(disabled: boolean): React.CSSProperties {
  return {
    background: ACCENT,
    color: "#fff",
    border: "none",
    borderRadius: 9999,
    padding: "9px 24px",
    fontFamily: "Inter, sans-serif",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}
