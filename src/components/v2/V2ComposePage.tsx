import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  fetchShows,
  fetchProgress,
  fetchFriendGroupsForUser,
  fetchPrompts,
  insertThread,
  addThreadToGroup,
  logThreadPrompt,
} from "../../lib/db";
import type { Show, PromptRow } from "../../lib/db";
import type { ProgressEntry, FriendGroup } from "../../types";
import type { PromptEntry } from "../../lib/promptData";
import { getPromptSuggestion } from "../../lib/prompts";
import PromptCard from "../PromptCard";
import LoadingDots from "../LoadingDots";
import { Sparkles, X, ArrowRight } from "lucide-react";

// Compose-page cream palette + dark ink. Self-contained — V2Layout's
// chrome (white on green/mustard) wouldn't read on cream, and compose has
// its own top-right ("× not now") rather than the standard you-pill cluster.
const CREAM_BG = "#fef8ea";
const PAPER_BG = "#fdfbf3";
const INK = "#2b2418";
const INK_SOFT = "#5a4d3a";
const INK_FAINT = "#8a7860";
const RULE = "rgba(43, 36, 24, 0.32)";
const RULE_FAINT = "rgba(43, 36, 24, 0.14)";

// Ruled-paper math — line-height and background period MUST match exactly,
// or text drifts off the rules. Per spec: 28px line-height + 28px period,
// 14% rule opacity, 1px tall rules drawn at the bottom of each line.
const LH = 28;
const RULE_GRADIENT = `repeating-linear-gradient(
  to bottom,
  transparent 0px,
  transparent ${LH - 2}px,
  ${RULE_FAINT} ${LH - 2}px,
  ${RULE_FAINT} ${LH - 1}px,
  transparent ${LH - 1}px,
  transparent ${LH}px
)`;

const BODY_MIN_LINES = 6; // initial render = 6 lines = 168px

function progressShort(p: ProgressEntry): string {
  if (p.s === 0 && p.e === 0) return "haven't started";
  return `S${String(p.s).padStart(2, "0")} E${String(p.e).padStart(2, "0")}`;
}

// effectiveProgress for tag-time. Rewatchers tag at their highest;
// non-rewatchers at their current. (Same rule as the live ShowSection
// composer.)
function tagPosition(p: ProgressEntry): { s: number; e: number } {
  if (p.isRewatching && p.highestS != null && p.highestE != null) {
    return { s: p.highestS, e: p.highestE };
  }
  return { s: p.s, e: p.e };
}

// Live-summary copy for the destination chooser. Public + selected groups
// combine; up to 3 group names enumerated Oxford-style, 4+ collapses to
// "N friend rooms".
function buildSelectionSummary(
  groups: FriendGroup[],
  selectedGroupIds: Set<string>,
  selectedPublic: boolean,
  tag: string
): React.ReactNode {
  const rooms = groups.filter((g) => selectedGroupIds.has(g.id));
  const n = rooms.length;
  const baseline = (
    <>
      This entry will live in your private <strong>journal</strong>
    </>
  );

  // Phrase fragments for the rooms portion.
  let roomsPhrase: React.ReactNode = null;
  if (n === 1) {
    roomsPhrase = (
      <>
        post to your <strong>{rooms[0].name}</strong> friend room
      </>
    );
  } else if (n === 2) {
    roomsPhrase = (
      <>
        post to your <strong>{rooms[0].name}</strong> and <strong>{rooms[1].name}</strong> friend rooms
      </>
    );
  } else if (n === 3) {
    roomsPhrase = (
      <>
        post to your <strong>{rooms[0].name}</strong>, <strong>{rooms[1].name}</strong>, and <strong>{rooms[2].name}</strong> friend rooms
      </>
    );
  } else if (n >= 4) {
    roomsPhrase = (
      <>
        post to your <strong>{n} friend rooms</strong>
      </>
    );
  }

  const publicPhrase: React.ReactNode = (
    <>
      publish <strong>publicly</strong> — visible to anyone caught up to {tag}
    </>
  );

  if (n === 0 && !selectedPublic) {
    return <>{baseline}. You can share it further later.</>;
  }
  if (n > 0 && !selectedPublic) {
    return (
      <>
        {baseline}, and {roomsPhrase}.
      </>
    );
  }
  if (n === 0 && selectedPublic) {
    return (
      <>
        {baseline}, and {publicPhrase}.
      </>
    );
  }
  // Both selected — chain rooms, then public.
  return (
    <>
      {baseline}, {roomsPhrase}, and {publicPhrase}.
    </>
  );
}

export default function V2ComposePage({ showId }: { showId?: string }) {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();

  // Cream palette + has-header gradient flip. Self-managed (not via
  // V2Layout) so we can run our own dark ink color scheme without
  // overloading the public-context palette tokens.
  useEffect(() => {
    document.body.classList.add("v2-compose-context", "has-header");
    return () => {
      document.body.classList.remove("v2-compose-context", "has-header");
    };
  }, []);

  // Bootstrap.
  const [show, setShow] = useState<Show | null>(null);
  const [progress, setProgress] = useState<ProgressEntry | null>(null);
  const [groups, setGroups] = useState<FriendGroup[]>([]);
  const [promptEntries, setPromptEntries] = useState<PromptEntry[]>([]);
  const [showError, setShowError] = useState<string | null>(null);

  // Form state.
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [selectedPublic, setSelectedPublic] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

  // Prompt feature — same shape as live ShowSection.
  const [activePrompt, setActivePrompt] = useState<PromptEntry | null>(null);
  const [shownPromptIds, setShownPromptIds] = useState<number[]>([]);
  const [insertedPromptIds, setInsertedPromptIds] = useState<number[]>([]);

  // Submit + discard state.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Boot: shows + progress for this show + groups + prompts. Bails to
  // /v2/journal if the show isn't in the user's progress (no journal tab).
  useEffect(() => {
    if (!user || !showId) return;
    let cancelled = false;
    Promise.all([
      fetchShows(),
      fetchProgress(user.id),
      fetchFriendGroupsForUser(user.id, showId),
      fetchPrompts().catch(() => [] as PromptRow[]),
    ])
      .then(([allShows, prog, gs, pr]) => {
        if (cancelled) return;
        const s = allShows.find((x) => x.id === showId);
        if (!s) {
          setShowError("show not found");
          return;
        }
        const p = prog[showId];
        if (!p) {
          setShowError("no journal tab for this show — open it from /v2/journal first");
          return;
        }
        // Convert snake_case PromptRow → camelCase PromptEntry that
        // getPromptSuggestion expects. Same shape as ShowSection's mapper.
        const entries: PromptEntry[] = pr.map((r) => ({
          id: r.id,
          text: r.text,
          displayType: r.display_type,
          tvmazeTypes: r.tvmaze_types,
          genres: r.genres,
          progressTags: r.progress_tags,
          themes: r.themes,
        }));
        setShow(s);
        setProgress(p);
        setGroups(gs);
        setPromptEntries(entries);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2ComposePage bootstrap failed:", err);
        setShowError("couldn't load this show");
      });
    return () => { cancelled = true; };
  }, [user?.id, showId]);

  // Auto-grow textarea — snaps to 28px multiples. Only grows. Manual resize
  // taller is preserved; min-height tracks content so manual resize can't
  // hide text.
  function autosize() {
    const ta = bodyRef.current;
    if (!ta) return;
    const prev = ta.style.height;
    ta.style.height = "auto";
    const sh = ta.scrollHeight;
    ta.style.height = prev;
    const target = Math.max(BODY_MIN_LINES * LH, Math.ceil(sh / LH) * LH);
    const current = parseInt(ta.style.height, 10) || BODY_MIN_LINES * LH;
    ta.style.height = `${Math.max(target, current)}px`;
    ta.style.minHeight = `${target}px`;
  }

  // Initial sizing on mount + when body changes.
  useEffect(() => { autosize(); }, [postBody]);

  // === PROMPT HANDLERS ===
  // Same triple-handler shape as live ShowSection. handlePromptBtn opens
  // the card (or shuffles to next if open); handlePromptInsert injects
  // [PROMPT: text] at cursor.
  function handlePromptBtn() {
    if (!show || !progress) return;
    const tag = tagPosition(progress);
    const next = getPromptSuggestion(show, { s: tag.s, e: tag.e }, shownPromptIds, promptEntries);
    if (next) {
      setShownPromptIds((prev) => [...prev, next.id]);
      setActivePrompt(next);
    }
  }
  function handlePromptShuffle() {
    handlePromptBtn();
  }
  function handlePromptInsert(text: string) {
    if (!activePrompt) return;
    const token = `[PROMPT: ${text}]`;
    const ta = bodyRef.current;
    if (ta) {
      const pos = ta.selectionStart ?? postBody.length;
      const before = postBody.slice(0, pos).trimEnd();
      const after = postBody.slice(pos).trimStart();
      const prefix = before.length ? "\n" : "";
      const suffix = "\n";
      const newBody = before + prefix + token + suffix + after;
      const newPos = before.length + prefix.length + token.length + suffix.length;
      setPostBody(newBody);
      requestAnimationFrame(() => {
        ta.selectionStart = newPos;
        ta.selectionEnd = newPos;
        ta.focus();
      });
    } else {
      setPostBody((prev) => prev.trimEnd() + (prev.trim() ? "\n" : "") + token + "\n");
    }
    setInsertedPromptIds((prev) => [...prev, activePrompt.id]);
    setActivePrompt(null);
  }

  // === DISCARD ===
  // Confirmation only when title or body has content. Same modal regardless
  // of which "× not now" was clicked (top-right or action row).
  function attemptDiscard() {
    const dirty = postTitle.trim().length > 0 || postBody.trim().length > 0;
    if (dirty) {
      setDiscardOpen(true);
    } else {
      doDiscard();
    }
  }
  function doDiscard() {
    if (showId) navigate(`/v2/journal/${showId}`);
    else navigate("/v2/journal");
  }

  // === SUBMIT ===
  async function submitPost() {
    if (!user || !profile || !show || !progress) return;
    const title = postTitle.trim();
    const body = postBody.trim();
    if (!title && !body) {
      setSubmitError("Add a title or body before posting.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const tag = tagPosition(progress);
      const threadData = {
        showId: show.id,
        season: tag.s,
        episode: tag.e,
        authorId: user.id,
        authorName: profile.username,
        title: title || "Untitled note",
        preview: body.slice(0, 240) + (body.length > 240 ? "…" : ""),
        body: body || "(blank)",
        isRewatch: progress.isRewatching ?? false,
        rewatchSeason: progress.isRewatching ? (progress.rewatchS ?? progress.s) : undefined,
        rewatchEpisode: progress.isRewatching ? (progress.rewatchE ?? progress.e) : undefined,
        isPublic: selectedPublic,
      };
      const t = await insertThread(threadData);
      // Apply each selected room. Best-effort: a room failing to attach
      // doesn't abort the post (consistent with how live ShowSection
      // handles the single-room case at ShowSection.tsx:1660).
      for (const groupId of Array.from(selectedGroupIds)) {
        await addThreadToGroup(t.id, groupId).catch((err) => {
          console.warn(`addThreadToGroup failed thread=${t.id} group=${groupId}:`, err);
        });
      }
      // Log prompt usage.
      for (const pid of insertedPromptIds) {
        logThreadPrompt(t.id, pid).catch(() => {});
      }
      // Land back on the journal — new entry shows up at the top with
      // its derived chips. (Post-publish reveal is tabled for a later
      // checkpoint per spec.)
      navigate(`/v2/journal/${show.id}`);
    } catch (err: any) {
      console.warn("submit failed:", err);
      setSubmitError(err?.message || "Post failed. Try again.");
      setSubmitting(false);
    }
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  // === GUARDS ===
  if (!authLoading && !user) {
    return <div style={{ padding: 24, color: INK_SOFT }}>sign in to write.</div>;
  }
  if (showError) {
    return (
      <div style={{ minHeight: "100vh", padding: "100px 24px", color: INK }}>
        <div style={{ maxWidth: 540, margin: "0 auto", textAlign: "center", fontFamily: "Lora, Georgia, serif", fontStyle: "italic", color: INK_SOFT }}>
          {showError}
        </div>
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button className="btn h40" onClick={() => navigate("/v2/journal")}>back to journal</button>
        </div>
      </div>
    );
  }
  if (!show || !progress) {
    return (
      <div style={{ minHeight: "100vh", padding: "100px 24px", textAlign: "center", color: INK_SOFT, fontStyle: "italic" }}>
        loading<LoadingDots />
      </div>
    );
  }

  const tag = tagPosition(progress);
  const tagShort = `S${String(tag.s).padStart(2, "0")} E${String(tag.e).padStart(2, "0")}`;
  const summary = buildSelectionSummary(groups, selectedGroupIds, selectedPublic, tagShort);

  return (
    <div style={{ minHeight: "100vh", position: "relative" }}>
      {/* compose-context cream paint via injected style */}
      <style>{`
        body.v2-compose-context { background: ${CREAM_BG} !important; color: ${INK}; }
        .v2-compose-paper-input::placeholder { color: ${INK_FAINT}; font-style: italic; }
        .v2-compose-title-input::placeholder { color: ${INK_FAINT}; font-weight: 500; font-style: italic; }
      `}</style>

      {/* TOP-RIGHT: × not now (duplicate of action-row cancel) */}
      <div style={{ position: "fixed", top: 28, right: 36, zIndex: 20 }}>
        <button
          onClick={attemptDiscard}
          style={{
            background: "transparent",
            border: `2px solid ${RULE}`,
            color: INK_SOFT,
            borderRadius: 9999,
            padding: "8px 18px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            height: 34,
          }}
        >
          × not now
        </button>
      </div>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "120px 48px 200px" }}>
        {/* === CONTEXT === */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div
            style={{
              fontFamily: "Lora, Georgia, serif",
              fontStyle: "italic",
              fontSize: 15,
              color: INK_FAINT,
              marginBottom: 4,
            }}
          >
            capture your fresh thoughts on:
          </div>
          <h1
            style={{
              fontFamily: "Lora, Georgia, serif",
              fontWeight: 700,
              fontSize: 36,
              letterSpacing: "0.02em",
              color: INK,
              textTransform: "uppercase",
              margin: 0,
              marginBottom: 10,
            }}
          >
            {show.name}
          </h1>
          <span
            className="btn post h40"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "default",
            }}
            title="your current progress on this show"
          >
            ◐ you've watched: {progressShort(progress)}
          </span>
          {progress.isRewatching && (
            <div
              style={{
                marginTop: 10,
                fontFamily: "Lora, Georgia, serif",
                fontStyle: "italic",
                fontSize: 13,
                color: INK_FAINT,
                maxWidth: 480,
                margin: "10px auto 0",
                lineHeight: 1.5,
              }}
            >
              Your post is automatically marked to {tagShort} — your highest prior progress as a re-watcher. It will only show to people who've watched at least that far.
            </div>
          )}
        </div>

        {/* === PAPER === */}
        <div
          style={{
            background: PAPER_BG,
            border: `2px solid ${RULE}`,
            borderRadius: 18,
            padding: "36px 40px",
            marginBottom: 24,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <input
            className="v2-compose-title-input"
            type="text"
            placeholder="title"
            value={postTitle}
            onChange={(e) => setPostTitle(e.target.value)}
            maxLength={200}
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 26,
              fontWeight: 600,
              color: INK,
              border: "none",
              background: "transparent",
              width: "100%",
              marginBottom: 24,
              outline: "none",
              letterSpacing: "-0.015em",
              lineHeight: 1.2,
            }}
          />
          <textarea
            ref={bodyRef}
            className="v2-compose-paper-input"
            placeholder={activePrompt ? "(insert a prompt below to get started, or just write)" : "What's something that's gonna stay with you?"}
            value={postBody}
            onChange={(e) => setPostBody(e.target.value)}
            maxLength={10000}
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 16,
              lineHeight: `${LH}px`,
              color: INK,
              border: "none",
              backgroundColor: "transparent",
              backgroundImage: RULE_GRADIENT,
              backgroundPosition: "0 0",
              backgroundSize: `100% ${LH}px`,
              backgroundRepeat: "repeat",
              width: "100%",
              minWidth: "100%",
              maxWidth: "100%",
              height: `${BODY_MIN_LINES * LH}px`,
              minHeight: `${BODY_MIN_LINES * LH}px`,
              resize: "vertical",
              overflow: "hidden",
              outline: "none",
              fontWeight: 400,
              padding: 0,
              margin: 0,
              display: "block",
            }}
          />
        </div>

        {/* === PROMPT BUTTON / CARD === */}
        {promptEntries.length > 0 && (
          <div style={{ marginTop: 4, marginBottom: 24 }}>
            {!activePrompt ? (
              <button
                onClick={handlePromptBtn}
                style={{
                  background: "var(--green)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 9999,
                  padding: "9px 18px",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Sparkles size={14} color="currentColor" /> want a prompt?
              </button>
            ) : (
              <PromptCard
                prompt={activePrompt}
                onClose={() => setActivePrompt(null)}
                onShuffle={handlePromptShuffle}
                onInsert={handlePromptInsert}
              />
            )}
          </div>
        )}

        {/* === DESTINATION CHOOSER === */}
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              textAlign: "center",
              fontFamily: "Lora, Georgia, serif",
              fontStyle: "italic",
              fontSize: 16,
              color: INK_SOFT,
              marginBottom: 14,
            }}
          >
            where does this entry live?
          </div>

          {/* Journal-as-baseline pill — quiet, persistent, not interactive. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "12px 22px",
              background: "rgba(43,36,24,0.05)",
              border: "none",
              borderRadius: 9999,
              maxWidth: 360,
              margin: "0 auto",
              fontFamily: "Lora, Georgia, serif",
              fontStyle: "italic",
              fontSize: 15,
              color: INK_SOFT,
            }}
          >
            ◐ in your private journal — always.
          </div>

          {groups.length > 0 || true ? (
            <>
              <div
                style={{
                  textAlign: "center",
                  fontFamily: "Lora, Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 14,
                  color: INK_FAINT,
                  margin: "24px 0 14px",
                }}
              >
                share it further?
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: 12,
                  marginBottom: 18,
                }}
              >
                {/* one card per friend room on this show */}
                {groups.map((g) => {
                  const selected = selectedGroupIds.has(g.id);
                  return (
                    <DestinationCard
                      key={g.id}
                      selected={selected}
                      paletteHex="#355eb8"
                      onClick={() => toggleGroup(g.id)}
                      title={
                        <>
                          friend room: <em style={{ fontStyle: "italic", fontWeight: 600 }}>{g.name}</em>
                        </>
                      }
                      description={`your friends will see your entry once they've watched ${tagShort}.`}
                      preState="stake your take — unlocks their entries"
                    />
                  );
                })}

                {/* public card */}
                <DestinationCard
                  selected={selectedPublic}
                  paletteHex="#dea838"
                  onClick={() => setSelectedPublic((v) => !v)}
                  title="public"
                  description={`visible to anyone caught up to ${tagShort}.`}
                  preState="deliberate"
                />
              </div>
            </>
          ) : null}

          <p
            style={{
              fontFamily: "Lora, Georgia, serif",
              fontStyle: "italic",
              fontSize: 14,
              color: INK_SOFT,
              lineHeight: 1.5,
              marginTop: 4,
              textAlign: "center",
              maxWidth: 580,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            {summary}
          </p>
        </div>

        {/* === ACTION ROW === */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            marginTop: 28,
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={attemptDiscard}
            disabled={submitting}
            style={{
              background: "transparent",
              border: `2px solid ${RULE}`,
              color: INK_SOFT,
              borderRadius: 9999,
              padding: "10px 20px",
              fontFamily: "Inter, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            × not now
          </button>
          <button
            onClick={submitPost}
            disabled={submitting}
            className="btn post h40"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            {submitting ? <>posting<LoadingDots /></> : <>post entry <ArrowRight size={14} /></>}
          </button>
        </div>
        {submitError && (
          <div style={{ textAlign: "right", marginTop: 8, color: "var(--danger)", fontSize: 13 }}>
            {submitError}
          </div>
        )}
      </main>

      {/* === DISCARD CONFIRM === */}
      {discardOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(43,36,24,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 20,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setDiscardOpen(false); }}
        >
          <div
            style={{
              background: PAPER_BG,
              border: `2px solid ${INK}`,
              borderRadius: 18,
              padding: "28px 32px",
              maxWidth: 420,
              width: "100%",
              color: INK,
            }}
          >
            <div style={{ fontFamily: "Lora, Georgia, serif", fontWeight: 600, fontSize: 20, marginBottom: 10 }}>
              Are you sure?
            </div>
            <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 15, color: INK_SOFT, marginBottom: 24 }}>
              You will lose what you've written.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => setDiscardOpen(false)}
                style={{
                  background: "transparent",
                  border: `2px solid ${RULE}`,
                  color: INK_SOFT,
                  borderRadius: 9999,
                  padding: "9px 18px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                keep writing
              </button>
              <button
                onClick={doDiscard}
                style={{
                  background: "var(--danger)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 9999,
                  padding: "9px 18px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <X size={13} /> discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// === DESTINATION CARD =========================================================
//
// Both states use the solid-fill-no-outline pattern (per v2 rule):
//   - Unselected: paper fill (#fdfbf3), dark ink text.
//   - Selected:   palette fill (full opacity), white text + white checkmark.
//
// The radius circle (top-right) uses the same rule per state: unselected is
// transparent-with-outline (no fill, 2px gray ring); selected is solid-white
// dot on the palette field (the white dot reads as a checkmark indicator
// against the colored card).

function DestinationCard({
  selected,
  paletteHex,
  onClick,
  title,
  description,
  preState,
}: {
  selected: boolean;
  paletteHex: string;
  onClick: () => void;
  title: React.ReactNode;
  description: string;
  preState: string;
}) {
  const inkOnFill = selected ? "#fff" : "#2b2418";
  const softInkOnFill = selected ? "rgba(255,255,255,0.85)" : "#8a7860";
  return (
    <button
      onClick={onClick}
      style={{
        background: selected ? paletteHex : "#fdfbf3",
        border: "none",
        borderRadius: 16,
        padding: "18px 20px",
        cursor: "pointer",
        position: "relative",
        textAlign: "left",
        fontFamily: "inherit",
        color: inkOnFill,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          width: 22,
          height: 22,
          borderRadius: "50%",
          // Unselected: transparent + outline. Selected: solid white dot.
          border: selected ? "none" : "2px solid rgba(43,36,24,0.32)",
          background: selected ? "#fff" : "transparent",
          color: paletteHex,
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          fontWeight: 700,
        }}
      >
        {selected ? "✓" : ""}
      </span>
      <div style={{ fontFamily: "Inter, sans-serif", fontSize: 16, fontWeight: 600, paddingRight: 30, marginBottom: 6, color: inkOnFill }}>
        {title}
      </div>
      <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 13, color: softInkOnFill, lineHeight: 1.45, marginBottom: 10 }}>
        {description}
      </div>
      <div
        style={{
          fontFamily: "Inter, sans-serif",
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: softInkOnFill,
        }}
      >
        {preState}
      </div>
    </button>
  );
}
