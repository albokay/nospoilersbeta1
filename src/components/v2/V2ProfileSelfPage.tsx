import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  fetchShows,
  fetchProgress,
  setCanonPin,
  setShelfBlurb,
  setStoppedWatching,
  type V2BlurbKind,
} from "../../lib/db";
import type { Show } from "../../lib/db";
import type { ProgressEntry } from "../../types";
import V2Layout from "./V2Layout";
import SearchShows from "../SearchShows";
import { Pencil, Plus, Pin } from "lucide-react";

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
        rightTo: "/v2/journal",
      }}
    >
      {/* === PROFILE IDENTITY === */}
      <header style={{ textAlign: "center", marginBottom: 32 }}>
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.25)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 36,
            fontWeight: 500,
            marginBottom: 18,
          }}
        >
          {(profile?.username ?? "?").charAt(0).toUpperCase()}
        </div>
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
            marginBottom: 8,
          }}
        >
          {profile?.username ?? "—"}
        </h1>
        <div style={{ fontSize: 14, color: "var(--dos-gray)", marginBottom: 12 }}>
          @{profile?.username ?? "—"}
        </div>
        {/* Bio area — edit-profile flow tabled per spec; showing the placeholder
            quietly until that lands. */}
        <p
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 17,
            color: "var(--dos-gray)",
            maxWidth: 540,
            margin: "0 auto",
            lineHeight: 1.5,
          }}
        >
          add a bio…
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 22 }}>
          <button className="btn h40" disabled title="edit-profile flow tabled per spec" style={{ opacity: 0.6, cursor: "not-allowed", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Pencil size={13} /> edit profile
          </button>
          <button className="btn h40" onClick={() => navigate(`/u/${profile?.username ?? ""}`)} title="opens your live public profile in this tab">
            share profile
          </button>
        </div>
      </header>

      {/* === META PROSE === */}
      <p
        style={{
          textAlign: "center",
          margin: "24px 0 56px",
          fontFamily: "Lora, Georgia, serif",
          fontStyle: "italic",
          fontSize: 16,
          color: "var(--dos-gray)",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
          {Object.keys(progress).length} shows
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
                    background: "rgba(255,250,235,0.55)",
                    border: "none",
                    padding: "22px 26px",
                    position: "relative",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                    <div style={{ fontSize: 22, fontWeight: 600, color: "var(--dos-fg)", lineHeight: 1.2 }}>{show.name}</div>
                    {p.isRewatching && <span style={{ fontSize: 12, color: "var(--dos-gray)", fontStyle: "italic" }}>rewatch</span>}
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <ProgressBadge progress={p} />
                  </div>
                  <div
                    style={{
                      paddingLeft: 14,
                      borderLeft: `2px solid ${progress[sid]?.watchingQuote ? "var(--danger)" : "rgba(255,255,255,0.4)"}`,
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
                  background: "rgba(255,250,235,0.55)",
                  border: "none",
                  padding: "14px 22px",
                }}
              >
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
                background: "transparent",
                border: "2px dashed rgba(255,255,255,0.6)",
                borderRadius: 24,
                padding: "14px 22px",
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                fontFamily: "Lora, Georgia, serif",
                fontStyle: "italic",
                fontSize: 15,
                color: "var(--dos-gray)",
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
                background: "rgba(255,250,235,0.55)",
                border: "none",
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
                    background: "rgba(255,250,235,0.55)",
                    border: "none",
                    padding: "20px 22px",
                    position: "relative",
                  }}
                >
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

      {/* === STOPPED WATCHING === */}
      {buckets.stopped.length > 0 && (
        <section style={{ marginBottom: 56 }}>
          <ShelfHead eyebrow="shows you've stopped, for now:" title="Stopped Watching" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {buckets.stopped.map((sid) => {
              const show = shows.find((s) => s.id === sid);
              const p = progress[sid];
              if (!show || !p || !user) return null;
              return (
                <article
                  key={sid}
                  className="card"
                  style={{
                    background: "rgba(255,250,235,0.55)",
                    border: "none",
                    padding: "16px 22px",
                    display: "grid",
                    gridTemplateColumns: "220px 1fr",
                    gap: 24,
                    alignItems: "baseline",
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--dos-fg)" }}>
                    {show.name}
                    <span style={{ display: "block", marginTop: 3, fontSize: 11, fontWeight: 500, color: "var(--dos-gray)" }}>
                      stopped at {progressShort(p)}
                    </span>
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

function ProgressBadge({ progress }: { progress: ProgressEntry }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "var(--green)",
        color: "#fff",
        padding: "4px 12px",
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      ◐ {progressShort(progress)}
    </span>
  );
}
