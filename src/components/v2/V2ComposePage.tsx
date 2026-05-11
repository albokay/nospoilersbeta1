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
  persistProgressUpdate,
} from "../../lib/db";
import OneSelectProgress from "../OneSelectProgress";
import { getCachedComposeData, clearComposeDataCache } from "../../lib/composeDataCache";
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
  // Single-select destination model — null until the user makes a choice.
  // The post-entry button is disabled (and rendered minimally) until a
  // destination is selected. "private" / "public" are special string
  // values; any other string is a friend_group id (post is also added
  // to that room via group_threads).
  const [destination, setDestination] = useState<"private" | "public" | string | null>(null);

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
  // /v3/journal if the show isn't in the user's progress (no journal tab).
  // Cache fast-path: if the V3JournalPage write button's hover prefetch
  // populated composeDataCache (see lib/composeDataCache), hydrate state
  // synchronously from the cache and skip the fetch entirely. Cache miss
  // (touch device, fast click without hover, prefetch failure) falls
  // through to the regular fetch path below.
  useEffect(() => {
    if (!user || !showId) return;
    const cached = getCachedComposeData(user.id, showId);
    if (cached) {
      setShow(cached.show);
      setProgress(cached.progress);
      setGroups(cached.groups);
      setPromptEntries(cached.promptEntries);
      return;
    }
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
          setShowError("no journal tab for this show — open it from /v3/journal first");
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
    // v3 journal mounts at the bare /v3/journal path and selects the active
    // tab via location.state.activeTab (V3JournalPage reads it on mount,
    // same pattern as live ProfilePage). Showless fallback drops the state.
    if (showId) navigate("/v3/journal", { state: { activeTab: showId } });
    else navigate("/v3/journal");
  }

  // === SUBMIT ===
  async function submitPost() {
    if (!user || !profile || !show || !progress) return;
    // Belt-and-suspenders: the post-entry button is rendered disabled when
    // destination is null, but guard here too so a stray keyboard / form
    // submit can't sneak through.
    if (destination === null) return;
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
        isPublic: destination === "public",
      };
      const t = await insertThread(threadData);
      // Single-destination model: if the user picked a friend room, attach
      // the post there. Best-effort attach (matches the live insertThread +
      // addThreadToGroup pattern in ProfilePage.tsx:533 and
      // ShowSection.tsx:1660). "private" + "public" need no extra step.
      if (destination !== "private" && destination !== "public") {
        await addThreadToGroup(t.id, destination).catch((err) => {
          console.warn(`addThreadToGroup failed thread=${t.id} group=${destination}:`, err);
        });
      }
      // Log prompt usage.
      for (const pid of insertedPromptIds) {
        logThreadPrompt(t.id, pid).catch(() => {});
      }
      // Land directly on the new thread so the user can immediately read
      // it / share / reply. Public destinations land in public-context;
      // friend-room destinations need the active-room sessionStorage marker
      // so ShowSection mounts the thread inside the room. We're navigating
      // from /v2/compose (a different route family) so SPA navigate is
      // safe — App will mount ShowSection fresh.
      if (destination !== "private" && destination !== "public") {
        try { sessionStorage.setItem(`ns_active_group_${show.id}`, destination); } catch {}
      } else {
        try { sessionStorage.removeItem(`ns_active_group_${show.id}`); } catch {}
      }
      // Invalidate the prefetch cache so the next compose visit re-fetches
      // (the just-published post would otherwise be missing from group/
      // progress derivations on the prefetch's next hover).
      clearComposeDataCache(user.id, show.id);
      navigate(`/show/${show.id}/thread/${t.id}`);
    } catch (err: any) {
      console.warn("submit failed:", err);
      setSubmitError(err?.message || "Post failed. Try again.");
      setSubmitting(false);
    }
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
          <button className="btn h40" onClick={() => navigate("/v3/journal")}>back to journal</button>
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

  return (
    <div style={{ minHeight: "100vh", position: "relative", animation: "v2-compose-fade-in 350ms linear" }}>
      {/* compose-context cream paint via injected style.
          The !important overrides on the input/textarea below claw back from
          theme.ts:293-296's global "textarea { background: #fff !important; color: #000 !important }"
          rule, which would otherwise wipe out the ruled-paper gradient + ink
          color on the body textarea and the cream bg / ink color on the title
          input. Scoped to the v2-compose-* class names so no other textarea
          on the site is affected. */}
      <style>{`
        @keyframes v2-compose-fade-in { from { opacity: 0; } to { opacity: 1; } }
        body.v2-compose-context { background: ${CREAM_BG} !important; color: ${INK}; }
        .v2-compose-paper-input {
          background-color: #fff !important;
          background-image: ${RULE_GRADIENT} !important;
          background-position: 0 0 !important;
          background-size: 100% ${LH}px !important;
          background-repeat: repeat !important;
          color: ${INK} !important;
        }
        .v2-compose-paper-input::placeholder { color: ${INK_FAINT}; font-style: italic; }
        .v2-compose-title-input {
          background-color: transparent !important;
          background-image: none !important;
          color: ${INK} !important;
        }
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
            capture your thoughts on:
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
          {/* Universal watch-progress updater. Doubles as a reminder
              ("make sure this is right before posting") and an inline
              control to update if it isn't. Confirms in-modal on change
              (requireConfirm default = true), then persists globally via
              persistProgressUpdate so other surfaces — live ProfilePage,
              V3JournalPage, ShowSection — pick up the new value on their
              next mount/refetch. Local progress state mirrors the returned
              entry so this page's tag computation + rewatch annotation
              update immediately. */}
          <OneSelectProgress
            show={show}
            value={progress}
            onConfirm={async (next) => {
              if (!user) return;
              try {
                const updated = await persistProgressUpdate(user.id, show.id, progress, next);
                setProgress(updated);
              } catch (err) {
                console.warn("compose: persistProgressUpdate failed:", err);
              }
            }}
          />
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

        {/* === PAPER ===
            Sharp-cornered, white-fill outer container. White extends through
            the entire writing surface — title sits on white at the top, then
            the textarea below carries the ruled-paper gradient. Prompt button
            lives inside the box, below the textarea, so it reads as part of
            the writing unit rather than a separate after-the-paper affordance. */}
        <div
          style={{
            background: "#fff",
            border: `2px solid ${RULE}`,
            borderRadius: 0,
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
              backgroundColor: "#fff",
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

          {/* Prompt button / card — inside the paper, below the textarea */}
          {promptEntries.length > 0 && (
            <div style={{ marginTop: 16 }}>
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
        </div>

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
            who would you like to share this with?
          </div>

          {/* Single-select destination pills — h40 (height-matched to the
              post-entry button), always full opacity, with a cream radio
              circle on the left. Selected radio shows an inner dot in the
              pill's bg color. Order per spec: friend rooms, private,
              public. Default state is null (nothing selected) — the user
              must pick before posting.
              Layout: grid with a single max-content column so all pills
              share the width of the widest one's content (no dead space
              on the right when titles are short). */}
          <div style={{ display: "grid", gridTemplateColumns: "max-content", justifyContent: "center", gap: 8 }}>
            {groups.map((g) => (
              <DestinationPill
                key={g.id}
                selected={destination === g.id}
                bg="#adc8d7"
                fg="#fff"
                title={<>my friends: <em style={{ fontStyle: "italic", fontWeight: 700 }}>{g.name}</em></>}
                onClick={() => setDestination(g.id)}
              />
            ))}
            <DestinationPill
              selected={destination === "private"}
              bg="#7abd8e"
              fg="#fff"
              title="keep it private"
              onClick={() => setDestination("private")}
            />
            <DestinationPill
              selected={destination === "public"}
              bg="#dea838"
              fg="#fff"
              title="the public"
              onClick={() => setDestination("public")}
            />
          </div>

          {/* Dynamic explainer — renders only after the user picks a
              destination. Sits between the pills and the not-now /
              post-entry action row, replacing the multi-select summary
              we removed earlier with a single-line context paragraph. */}
          {destination !== null && (
            <p
              style={{
                fontFamily: "Lora, Georgia, serif",
                fontStyle: "italic",
                fontSize: 14,
                color: INK_SOFT,
                lineHeight: 1.5,
                marginTop: 18,
                marginBottom: 0,
                textAlign: "center",
                maxWidth: 580,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              {destination === "public"
                ? <>Anyone who's watched <strong>{tagShort}</strong> can read your writing.</>
                : destination === "private"
                ? <>No one else will see. Some of your best thinking happens when you write for yourself…</>
                : <>Your friends will see your entry once they've watched <strong>{tagShort}</strong>.</>}
            </p>
          )}
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
            disabled={submitting || destination === null}
            className="btn post h40"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              // When no destination is chosen, render the button as a
              // dimmed empty pill (no text/icon) — visually communicates
              // "this exists but isn't actionable yet" without removing
              // the affordance entirely. minWidth keeps the pill shape
              // visible at h40 even with empty content.
              opacity: destination === null ? 0.4 : 1,
              cursor: (submitting || destination === null) ? "not-allowed" : "pointer",
              minWidth: 130,
            }}
          >
            {destination === null
              ? null
              : submitting
                ? <>posting<LoadingDots /></>
                : <>post entry<ArrowRight size={14} /></>}
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

// === DESTINATION PILL =========================================================
//
// Single-select pill button — h40 (height-matched to the post-entry button),
// always full opacity (no opacity-as-selection-state per the latest spec).
// Solid bg + no border per "no outline" rule. Selection cue is a radio circle
// on the left: empty = cream-filled circle (matches the page bg) so it reads
// as an unfilled radio; selected = the same cream circle with an inner dot
// in the pill's bg color. Title-only — no subheads (the dynamic explainer
// below the pills carries the per-choice context).

function DestinationPill({
  selected,
  bg,
  fg,
  title,
  onClick,
}: {
  selected: boolean;
  bg: string;
  fg: string;
  title: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{
        background: bg,
        color: fg,
        border: "none",
        borderRadius: 9999,
        height: 40,
        padding: "0 22px",
        // Width is driven by the parent grid's max-content column, so all
        // pills share the width of the widest one's content. width:100%
        // makes each pill fill that grid column.
        width: "100%",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "inherit",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: CREAM_BG,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {selected && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: bg,
            }}
          />
        )}
      </span>
      <span style={{ fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 600, color: fg, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {title}
      </span>
    </button>
  );
}
