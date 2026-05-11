import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  fetchShows,
  fetchProgress,
  setCanonPin,
  setShelfBlurb,
  setStoppedWatching,
  removeShowFromProfile,
  type V2BlurbKind,
} from "../../lib/db";
import type { Show } from "../../lib/db";
import type { ProgressEntry } from "../../types";
import V2Layout from "./V2Layout";
import SearchShows from "../SearchShows";
import Modal from "../Modal";
import { Plus, Pin, Trash2 } from "lucide-react";

// Shared profile-card style — sharp corners, transparent fill, 2px white
// outline. Lets the canon-yellow page bg show through; the white outline
// reads as a decisive frame without competing with the bg color or
// introducing any "middle transparency." .card class still applies;
// these inline styles override its radius (24) and bg.
const PROFILE_CARD: React.CSSProperties = {
  background: "transparent",
  border: "2px solid #fff",
  borderRadius: 0,
  boxShadow: "none",
};

// Dashed variant for "+ add a show" tile — telegraphs "click to add"
// against the same transparent + white visual language.
const PROFILE_ADD_TILE: React.CSSProperties = {
  background: "transparent",
  border: "2px dashed #fff",
  borderRadius: 0,
  boxShadow: "none",
};

type ShelfStatus = "watching" | "want" | "finished" | "stopped";

function classifyShow(p: ProgressEntry, show: Show | undefined): ShelfStatus {
  if (p.stoppedWatching) return "stopped";
  if (p.s === 0 && p.e === 0) return "want";
  if (show?.seasons && show.seasons.length > 0) {
    const finalS = show.seasons.length;
    const finalE = show.seasons[finalS - 1];
    const checkS = p.isRewatching ? (p.highestS ?? p.s) : p.s;
    const checkE = p.isRewatching ? (p.highestE ?? p.e) : p.e;
    if (checkS >= finalS && checkE >= finalE) return "finished";
  }
  return "watching";
}

function progressShort(p: ProgressEntry): string {
  if (p.s === 0 && p.e === 0) return "haven't started";
  return `S${String(p.s).padStart(2, "0")} E${String(p.e).padStart(2, "0")}`;
}

function formatJoinedSince(createdAt?: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

// Inline editable blurb. Click pencil → text field; Enter / blur saves;
// Esc cancels. Whitespace-only saves as null per setShelfBlurb's contract.
function BlurbField({
  kind,
  value,
  placeholder,
  italic,
  onSaved,
  userId,
  showId,
}: {
  kind: V2BlurbKind;
  value: string | undefined;
  placeholder: string;
  italic?: boolean;
  onSaved: (next: string | undefined) => void;
  userId: string;
  showId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function commit() {
    if (saving) return;
    const next = draft.trim();
    if ((next || "") === (value ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await setShelfBlurb(userId, showId, kind, next || null);
      onSaved(next || undefined);
      setEditing(false);
    } catch (err) {
      console.warn("setShelfBlurb failed (recoverable):", err);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <textarea
        autoFocus
        className="card"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            commit();
          }
        }}
        placeholder={placeholder}
        maxLength={280}
        style={{
          width: "100%",
          minHeight: 60,
          fontSize: 15,
          lineHeight: 1.5,
          fontFamily: "Lora, Georgia, serif",
          fontStyle: italic ? "italic" : "normal",
          color: "var(--dos-fg)",
          background: "rgba(255,255,255,0.18)",
          border: "2px solid #fff",
          borderRadius: 14,
          padding: 12,
          resize: "vertical",
          outline: "none",
        }}
      />
    );
  }

  const isPlaceholder = !value;

  return (
    <div
      onClick={() => setEditing(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") setEditing(true); }}
      style={{
        cursor: "text",
        fontFamily: italic ? "Lora, Georgia, serif" : undefined,
        fontStyle: italic ? "italic" : undefined,
        fontSize: 15,
        lineHeight: 1.5,
        color: isPlaceholder ? "var(--dos-gray)" : "var(--dos-fg)",
        opacity: isPlaceholder ? 0.7 : 1,
      }}
    >
      {value || placeholder}
    </div>
  );
}

export default function V2ProfileSelfPage() {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();

  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [addOpen, setAddOpen] = useState(false);

  // "Remove this show from profile" — small Trash button on every show
  // card opens a confirmation modal. On confirm, runs
  // removeShowFromProfile (room cascade + DELETE progress row) and prunes
  // the show from local state so the shelf re-renders without it. Threads
  // and replies on the show are NOT touched.
  const [removeShowId, setRemoveShowId] = useState<string | null>(null);
  const [removeSubmitting, setRemoveSubmitting] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([fetchShows(), fetchProgress(user.id)])
      .then(([s, p]) => {
        if (cancelled) return;
        setShows(s);
        setProgress(p);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2ProfileSelfPage bootstrap failed:", err);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const buckets = useMemo(() => {
    const out: Record<ShelfStatus, string[]> = { watching: [], want: [], finished: [], stopped: [] };
    for (const sid of Object.keys(progress)) {
      // TSP (Sidebar Protocol demo show) is a private onboarding/demo
      // surface — never surface it on the public-facing profile, even
      // for the profile owner. Stays filtered out of all four shelves.
      if (sid === "tsp") continue;
      const p = progress[sid];
      const show = shows.find((s) => s.id === sid);
      out[classifyShow(p, show)].push(sid);
    }
    // alphabetical within each shelf for stability
    const byName = (a: string, b: string) => {
      const an = shows.find((s) => s.id === a)?.name ?? a;
      const bn = shows.find((s) => s.id === b)?.name ?? b;
      return an.localeCompare(bn);
    };
    out.watching.sort(byName);
    out.want.sort(byName);
    out.finished.sort(byName);
    out.stopped.sort(byName);
    return out;
  }, [progress, shows]);

  // Pinned canon shows surface above the see-all link.
  const finishedPinned = buckets.finished.filter((sid) => progress[sid]?.canonPin);
  const finishedUnpinned = buckets.finished.filter((sid) => !progress[sid]?.canonPin);
  // For checkpoint 4 we render: pinned first, then unpinned, then a footer
  // "see all N shows" CTA. The expanded view (true canon expansion) is
  // tabled per the design spec; the CTA is visible-only.
  const finishedDisplay = [...finishedPinned, ...finishedUnpinned];

  if (!authLoading && !user) {
    return <V2Layout palette="profile"><div /></V2Layout>;
  }

  function updateLocalProgress(showId: string, patch: Partial<ProgressEntry>) {
    setProgress((prev) => ({ ...prev, [showId]: { ...prev[showId], ...patch } }));
  }

  return (
    <V2Layout
      palette="profile"
      pairedHeader={{
        left: "this is your public profile",
        rightLabel: "go to your journal",
        rightTo: "/v3/journal",
      }}
    >
      {/* === PROFILE IDENTITY ===
          Left-justified, no avatar / no @subhead / no edit+share buttons.
          The heading itself carries the @username; bio sits below as a
          quiet placeholder until Commit D wires inline-editing. */}
      <header style={{ textAlign: "left", marginBottom: 32 }}>
        <h1
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 600,
            fontSize: 48,
            letterSpacing: "0.02em",
            lineHeight: 1.05,
            color: "var(--dos-fg)",
            textTransform: "uppercase",
            margin: 0,
            marginBottom: 14,
          }}
        >
          @{profile?.username ?? "—"}
        </h1>
        {/* Bio placeholder — clickable inline-edit lands in Commit D
            (needs profiles.bio column migration). For now we show the
            new placeholder copy so the page reads correctly. */}
        <p
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 17,
            color: "var(--dos-gray)",
            maxWidth: 540,
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          share something about who you are as a TV viewer…
        </p>
      </header>

      {/* === META PROSE === */}
      <p
        style={{
          textAlign: "left",
          margin: "24px 0 56px",
          fontFamily: "Lora, Georgia, serif",
          fontStyle: "italic",
          fontSize: 16,
          color: "var(--dos-gray)",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
          {Object.keys(progress).filter((s) => s !== "tsp").length} shows
        </strong>
        {" · "}
        <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
          {buckets.watching.length} watching now
        </strong>
        {" · "}
        <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
          {buckets.want.length} want to watch
        </strong>
        {user?.created_at ? ` · on Sidebar since ${formatJoinedSince(user.created_at)}` : ""}
      </p>

      {/* === WATCHING NOW === */}
      {buckets.watching.length > 0 && (
        <section style={{ marginBottom: 56 }}>
          <ShelfHead eyebrow="what you're in the middle of:" title="Watching Now" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
            {buckets.watching.map((sid) => {
              const show = shows.find((s) => s.id === sid);
              const p = progress[sid];
              if (!show || !p || !user) return null;
              return (
                <article
                  key={sid}
                  className="card"
                  style={{
                    ...PROFILE_CARD,
                    padding: "22px 26px 36px",
                    position: "relative",
                  }}
                >
                  <DeleteShowButton onClick={() => { setRemoveShowId(sid); setRemoveError(null); }} />
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                    <div style={{ display: "inline-flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 22, fontWeight: 600, color: "var(--dos-fg)", lineHeight: 1.2 }}>{show.name}</span>
                      <ProgressBadge progress={p} />
                    </div>
                    {p.isRewatching && <span style={{ fontSize: 12, color: "var(--dos-gray)", fontStyle: "italic" }}>rewatch</span>}
                  </div>
                  <div
                    style={{
                      paddingLeft: 14,
                      borderLeft: `2px solid ${progress[sid]?.watchingQuote ? "var(--danger)" : "rgba(0,0,0,0.12)"}`,
                    }}
                  >
                    <BlurbField
                      kind="watching_quote"
                      value={p.watchingQuote}
                      placeholder="add a first impression…"
                      italic
                      userId={user.id}
                      showId={sid}
                      onSaved={(v) => updateLocalProgress(sid, { watchingQuote: v })}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* === WANT TO WATCH (always renders for the + add tile) === */}
      <section style={{ marginBottom: 56 }}>
        <ShelfHead eyebrow="on your list, not yet started:" title="Want to Watch" />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {buckets.want.map((sid) => {
            const show = shows.find((s) => s.id === sid);
            const p = progress[sid];
            if (!show || !p || !user) return null;
            return (
              <article
                key={sid}
                className="card"
                style={{
                  ...PROFILE_CARD,
                  padding: "14px 60px 14px 22px",
                  position: "relative",
                }}
              >
                <DeleteShowButton onClick={() => { setRemoveShowId(sid); setRemoveError(null); }} />
                <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 14 }}>
                  <span style={{ fontSize: 17, fontWeight: 600, color: "var(--dos-fg)" }}>{show.name}</span>
                  <span style={{ flex: 1, minWidth: 200 }}>
                    <BlurbField
                      kind="want_reason"
                      value={p.wantReason}
                      placeholder="add a reason…"
                      italic
                      userId={user.id}
                      showId={sid}
                      onSaved={(v) => updateLocalProgress(sid, { wantReason: v })}
                    />
                  </span>
                </div>
              </article>
            );
          })}

          {/* + add tile — opens inline SearchShows. The component already
              defaults to (0,0) per 80299d9 so any pick lands as want-to-watch. */}
          {!addOpen ? (
            <button
              onClick={() => setAddOpen(true)}
              className="card"
              style={{
                ...PROFILE_ADD_TILE,
                padding: "14px 22px",
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                fontFamily: "Lora, Georgia, serif",
                fontStyle: "italic",
                fontSize: 15,
                color: "var(--dos-fg)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Plus size={16} color="currentColor" /> add a show to your list
            </button>
          ) : (
            <div
              className="card"
              style={{
                ...PROFILE_CARD,
                padding: "16px 22px",
              }}
            >
              <SearchShows
                shows={shows}
                progress={progress}
                onShowCreated={async (s) => {
                  // Onboarding default is (0,0) — show lands in the want-to-watch shelf naturally.
                  if (!user) return;
                  const next = await fetchProgress(user.id);
                  setProgress(next);
                  setAddOpen(false);
                }}
                onReopenJournal={async (showId) => {
                  // Resurrection from the profile + add tile: clear the
                  // stopped flag if set, then route to the journal.
                  if (user && progress[showId]?.stoppedWatching) {
                    try {
                      await setStoppedWatching(user.id, showId, false);
                    } catch (err) {
                      console.warn("clear-stopped failed:", err);
                    }
                  }
                  navigate(`/v2/journal/${showId}`);
                }}
                onAuthRequired={() => navigate("/")}
                placeholder="find a show"
              />
              <button
                onClick={() => setAddOpen(false)}
                className="btn h40"
                style={{ marginTop: 12, fontSize: 12 }}
              >
                cancel
              </button>
            </div>
          )}
        </div>
      </section>

      {/* === FINISHED WATCHING === */}
      {finishedDisplay.length > 0 && (
        <section style={{ marginBottom: 56 }}>
          <ShelfHead eyebrow="shows you've completed:" title="Finished Watching" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {finishedDisplay.map((sid) => {
              const show = shows.find((s) => s.id === sid);
              const p = progress[sid];
              if (!show || !p || !user) return null;
              const pinned = !!p.canonPin;
              return (
                <article
                  key={sid}
                  className="card"
                  style={{
                    ...PROFILE_CARD,
                    padding: "20px 22px 36px",
                    position: "relative",
                  }}
                >
                  <DeleteShowButton onClick={() => { setRemoveShowId(sid); setRemoveError(null); }} />
                  <button
                    onClick={async () => {
                      try {
                        await setCanonPin(user.id, sid, !pinned);
                        updateLocalProgress(sid, { canonPin: !pinned });
                      } catch (err) {
                        console.warn("setCanonPin failed:", err);
                      }
                    }}
                    title={pinned ? "in your canon — click to remove" : "add to your canon"}
                    style={{
                      position: "absolute",
                      top: 14,
                      right: 14,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: pinned ? "4px 10px" : 4,
                      borderRadius: 9999,
                      color: pinned ? "var(--danger)" : "var(--dos-gray)",
                      fontFamily: pinned ? "Lora, Georgia, serif" : undefined,
                      fontStyle: pinned ? "italic" : undefined,
                      fontWeight: pinned ? 500 : undefined,
                      fontSize: pinned ? 13 : undefined,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    {pinned ? "canon" : <Pin size={14} color="currentColor" />}
                  </button>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "var(--dos-fg)", lineHeight: 1.2, paddingRight: 64, marginBottom: 10 }}>
                    {show.name}
                  </div>
                  <BlurbField
                    kind="canon_take"
                    value={p.canonTake}
                    placeholder="add a take…"
                    italic
                    userId={user.id}
                    showId={sid}
                    onSaved={(v) => updateLocalProgress(sid, { canonTake: v })}
                  />
                </article>
              );
            })}
          </div>
          {/* see-all CTA — wired in a later checkpoint when the expanded view is designed. */}
          <div style={{ textAlign: "center", marginTop: 18 }}>
            <button
              className="btn h40"
              disabled
              title="expanded view tabled per spec"
              style={{ opacity: 0.6, cursor: "not-allowed" }}
            >
              see all {buckets.finished.length} {buckets.finished.length === 1 ? "show" : "shows"}
            </button>
          </div>
        </section>
      )}

      {/* === STOPPED WATCHING ===
          Same double-column grid as Finished Watching for shelf parity:
          repeat(auto-fit, minmax(280px, 1fr)) collapses to single column
          on narrow viewports. Title + "stopped at SXXEXX" inline like
          the Watching Now title row, then the blurb below. */}
      {buckets.stopped.length > 0 && (
        <section style={{ marginBottom: 56 }}>
          <ShelfHead eyebrow="shows you've stopped, for now:" title="Stopped Watching" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {buckets.stopped.map((sid) => {
              const show = shows.find((s) => s.id === sid);
              const p = progress[sid];
              if (!show || !p || !user) return null;
              return (
                <article
                  key={sid}
                  className="card"
                  style={{
                    ...PROFILE_CARD,
                    padding: "20px 22px 36px",
                    position: "relative",
                  }}
                >
                  <DeleteShowButton onClick={() => { setRemoveShowId(sid); setRemoveError(null); }} />
                  <div style={{ display: "inline-flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                    <span style={{ fontSize: 18, fontWeight: 600, color: "var(--dos-fg)", lineHeight: 1.2 }}>{show.name}</span>
                    <span style={{ fontSize: 12, color: "var(--dos-gray)", fontStyle: "italic" }}>stopped at {progressShort(p)}</span>
                  </div>
                  <BlurbField
                    kind="stopped_reason"
                    value={p.stoppedReason}
                    placeholder="add a reason…"
                    italic
                    userId={user.id}
                    showId={sid}
                    onSaved={(v) => updateLocalProgress(sid, { stoppedReason: v })}
                  />
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Delete-show-from-profile confirmation modal — same Modal shape
          as the V3 stop-watching modal (rounded card, no outline, Inter
          text). On confirm, removeShowFromProfile runs the room cascade
          and DELETEs the user's progress row; the show vanishes from
          every shelf. Threads + replies on the show are untouched. */}
      {removeShowId && user && profile && (() => {
        const sid = removeShowId;
        const sName = shows.find((s) => s.id === sid)?.name ?? sid;
        const closeIfIdle = () => { if (!removeSubmitting) { setRemoveShowId(null); setRemoveError(null); } };
        return (
          <Modal onClose={closeIfIdle} width="min(440px,92vw)">
            <div style={{ padding: "16px 12px 12px" }}>
              <p style={{ margin: "0 0 12px", fontSize: 17, lineHeight: 1.5, fontWeight: 600 }}>
                Remove <em>{sName}</em> from your profile?
              </p>
              <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.5, opacity: 0.85 }}>
                The show vanishes from every shelf. You'll leave any friend rooms on this show and need to be re-invited. Your journal entries and posts on the show stay where they are.
              </p>
              {removeError && (
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--danger)" }}>{removeError}</p>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  className="btn"
                  style={{ fontSize: 14, background: "transparent", border: "2px solid var(--danger)", color: "var(--danger)" }}
                  onClick={closeIfIdle}
                  disabled={removeSubmitting}
                >
                  Cancel
                </button>
                <button
                  className="btn"
                  style={{ fontSize: 14, background: "var(--danger)", border: "2px solid #fff", color: "#fff" }}
                  disabled={removeSubmitting}
                  onClick={async () => {
                    if (!user || !profile || !sid) return;
                    setRemoveSubmitting(true);
                    setRemoveError(null);
                    try {
                      await removeShowFromProfile(user.id, profile.username, sid);
                      // Prune from local state so the shelf re-renders
                      // without the show. App-level progress will refresh
                      // on the next navigation; this gives immediate
                      // feedback in the current view.
                      setProgress((prev) => {
                        const next = { ...prev };
                        delete next[sid];
                        return next;
                      });
                      setRemoveShowId(null);
                      setRemoveSubmitting(false);
                    } catch (err: any) {
                      console.warn("removeShowFromProfile failed:", err);
                      setRemoveError(err?.message || "Couldn't remove. Try again.");
                      setRemoveSubmitting(false);
                    }
                  }}
                >
                  {removeSubmitting ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </V2Layout>
  );
}

function ShelfHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 15, color: "var(--dos-gray)", marginBottom: 4 }}>
        {eyebrow}
      </div>
      <h2 style={{ fontFamily: "Lora, Georgia, serif", fontWeight: 600, fontSize: 28, letterSpacing: "0.04em", color: "var(--dos-fg)", textTransform: "uppercase", margin: 0 }}>
        {title}
      </h2>
    </div>
  );
}

// Small absolute-positioned trash button rendered on every show card.
// Opens the confirmation modal via the parent's onClick. Subtle (gray
// + low opacity) so it doesn't compete with the canon Pin or the show
// title; gains a hover state via title attribute. Bottom-right rather
// than top-right because Finished cards already have the Pin in the
// top-right corner.
function DeleteShowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Remove this show from your profile"
      aria-label="Remove from profile"
      style={{
        position: "absolute",
        bottom: 10,
        right: 12,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 6,
        borderRadius: 9999,
        color: "var(--dos-gray)",
        opacity: 0.55,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
      }}
    >
      <Trash2 size={14} color="currentColor" />
    </button>
  );
}

// Plain-text watch-progress indicator. Was a green pill; pills suggest
// interactability and this badge is read-only, so the new spec switches
// to inline text. Mono-spaced via Inter's tabular numerals reads as a
// label without competing visually with adjacent interactive pills.
function ProgressBadge({ progress }: { progress: ProgressEntry }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "var(--dos-fg)",
        fontSize: 13,
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      ◐ {progressShort(progress)}
    </span>
  );
}
