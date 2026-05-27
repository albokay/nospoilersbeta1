import React, { useState, useEffect, useRef, useMemo } from "react";
import { MessageSquare, Link2, X, Heart } from "lucide-react";

/** Resolves once the page finishes scrolling (scrollend event or debounce fallback). */
function afterScroll(): Promise<void> {
  return new Promise(resolve => {
    const hasScrollEnd: boolean = "onscrollend" in window;
    if (hasScrollEnd) {
      window.addEventListener("scrollend", () => resolve(), { once: true });
    } else {
      let t: ReturnType<typeof setTimeout>;
      const onScroll = () => {
        clearTimeout(t);
        t = setTimeout(() => { window.removeEventListener("scroll", onScroll); resolve(); }, 150);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      setTimeout(() => { window.removeEventListener("scroll", onScroll); resolve(); }, 800);
    }
  });
}

function flashEl(el: HTMLElement) {
  const s = getComputedStyle(el);
  el.style.position = s.position === "static" ? "relative" : s.position;
  const cover = document.createElement("div");
  cover.className = "flash-cover";
  el.appendChild(cover);
  setTimeout(() => cover.remove(), 1300);
}

import type { Thread, Reply } from "../types";
import type { CitationEntry, Highlight } from "../lib/db";
import {
  fetchRepliesForThread,
  likeReply as dbLikeReply,
  unlikeReply as dbUnlikeReply,
  editReply as dbEditReply,
  deleteReply as dbDeleteReply,
  fetchHighlights as dbFetchHighlights,
  createHighlight as dbCreateHighlight,
  deleteHighlight as dbDeleteHighlight,
} from "../lib/db";
import { useAuth } from "../lib/auth";
import { canView, timeAgo, effectiveProgress, type ViewerProgress } from "../lib/utils";
import EpisodeTag from "./EpisodeTag";
import Modal from "./Modal";
import LikeBadge from "./LikeBadge";
import LoadingDots from "./LoadingDots";
import Username from "./Username";
import Tooltip from "./Tooltip";
import HighlightPicker from "./HighlightPicker";
import HighlightableBody, { selectionToBodyOffsets } from "./v2/HighlightableBody";
import type { PendingReference } from "./ResponseComposer";
import { useScrollHighlight } from "../hooks/useScrollHighlight";
import { linkifyNodes } from "../lib/linkify";

// Matches [QUOTE: any text including newlines]
const QUOTE_TOKEN_RE = /\[QUOTE:([\s\S]*?)\]/;
// Matches [PROMPT: any text including newlines]
const PROMPT_TOKEN_RE = /\[PROMPT:([\s\S]*?)\]/g;

function superscriptNum(n: number): string {
  const supers = ["¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
  return supers[n - 1] ?? `(${n})`;
}

/** A pending inline citation superscript to be placed next to quoted text. */
type SupEntry = { citedText: string; index: number; onScrollTo: () => void };

/**
 * Nudge a match end-position so the sup lands after trailing punctuation
 * or at the end of a partially-matched word, rather than mid-word or
 * right before a punctuation mark.
 */
function adjustEndForSup(text: string, endPos: number): number {
  if (endPos >= text.length) return endPos;
  // Step 1: if mid-word, advance to end of word
  while (endPos < text.length && /\w/.test(text[endPos])) endPos++;
  // Step 2: then advance past any immediately following punctuation
  while (endPos < text.length && /[.,!?;:'"'"…\-)\]]/.test(text[endPos])) endPos++;
  return endPos;
}

/** Strip Unicode superscript digit characters that may have been captured in a text selection. */
function stripSupChars(text: string): string {
  return text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, "");
}

/**
 * Annotate a plain-text string with inline citation superscripts.
 * Each sup is placed immediately after the matched quoted passage,
 * adjusted past any trailing punctuation or partial word.
 * Returns the annotated node array plus the set of indices that were matched
 * (so callers can render unmatched sups as a fallback elsewhere).
 */
function annotateTextWithSups(
  text: string,
  sups: SupEntry[]
): { nodes: React.ReactNode[]; matchedIndices: Set<number> } {
  type Marker = { pos: number; endPos: number; index: number; onScrollTo: () => void };
  const markers: Marker[] = [];
  for (const s of sups) {
    const t = (s.citedText ?? "").replace(/…$/, "").trim();
    if (t.length < 4) continue;
    const idx = text.indexOf(t);
    if (idx !== -1) {
      const rawEnd = idx + t.length;
      const adjustedEnd = adjustEndForSup(text, rawEnd);
      markers.push({ pos: idx, endPos: adjustedEnd, index: s.index, onScrollTo: s.onScrollTo });
    }
  }
  const matchedIndices = new Set(markers.map(m => m.index));
  if (!markers.length) return { nodes: linkifyNodes([text]), matchedIndices };
  markers.sort((a, b) => a.endPos - b.endPos);
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const m of markers) {
    if (m.endPos <= last) continue; // skip overlapping
    const pos = Math.max(m.pos, last);
    if (pos > last) nodes.push(text.slice(last, pos));
    nodes.push(
      <span
        key={`qt-${m.index}`}
        className="quoted-passage"
        onClick={m.onScrollTo}
        title="Jump to citing response"
      >
        {text.slice(pos, m.endPos)}
      </span>
    );
    nodes.push(
      <sup key={`sup-${m.index}`} className="cite-sup">
        <button className="cite-sup-btn" onClick={m.onScrollTo} title="Jump to citing response">
          {superscriptNum(m.index)}
        </button>
      </sup>
    );
    last = m.endPos;
  }
  if (last < text.length) nodes.push(text.slice(last));
  // Linkify URL-shaped substrings inside the plain-text segments. The
  // citation spans / sups above pass through untouched (they're elements,
  // not strings), so quoted-passage highlighting and inline citations
  // continue to work alongside auto-linking.
  return { nodes: linkifyNodes(nodes), matchedIndices };
}

/** Small inline fallback sups for quotes whose text couldn't be found in the body. */
function UnmatchedSups({ sups }: { sups: Array<{ index: number; onScrollTo: () => void }> }) {
  if (!sups.length) return null;
  return (
    <span style={{ letterSpacing: 0 }}>
      {sups.map((s, i) => (
        <React.Fragment key={`usup-${s.index}`}>
          {i > 0 && <sup className="cite-sup"><span className="cite-sup-btn" style={{ cursor: "default" }}>,</span></sup>}
          <sup className="cite-sup">
            <button className="cite-sup-btn" onClick={s.onScrollTo} title="Jump to citing response">
              {superscriptNum(s.index)}
            </button>
          </sup>
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * Split text on [PROMPT: text] tokens and return an array of React nodes,
 * rendering each prompt token as a right-justified blockquote (.prompt-ref).
 * Any remaining plain segments are returned as-is (strings) for further processing.
 */
function parsePromptTokens(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(PROMPT_TOKEN_RE.source, "g");
  let keyIdx = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index).trimEnd());
    }
    const promptText = match[1].trim();
    parts.push(
      <blockquote key={`prompt-${keyIdx++}`} className="prompt-ref">
        {promptText}
      </blockquote>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last).trimStart());
  return parts;
}

/** Render a reply body, splitting on [QUOTE: text] or legacy [QUOTE] token,
 *  and injecting inline citation superscripts next to matched quoted passages. */
function ReplyBody({
  body,
  quotedText,
  authorName,
  currentUsername,
  referenceType,
  onScrollToRef,
  quoteSups = [],
  highlights = [],
  currentUserId = null,
  onDeleteHighlight,
}: {
  body: string;
  quotedText?: string | null;
  authorName?: string | null;
  currentUsername?: string | null;
  referenceType?: string | null;
  onScrollToRef?: () => void;
  /** Kept for API compatibility; not currently passed by the live caller
   *  in RepliesList (sup rendering is dormant). Reintroduced support would
   *  need to interleave with the highlight overlay layer. */
  quoteSups?: SupEntry[];
  /** Highlights on THIS reply (target_type='reply', target_id=r.id). Empty
   *  on non-friend-room replies — the create_highlight RPC requires a
   *  group_id, so non-friend-room replies can never have any. */
  highlights?: Highlight[];
  currentUserId?: string | null;
  onDeleteHighlight?: (id: string) => void;
}) {
  // Suppress the unused-quoteSups warning while the API surface is preserved.
  void quoteSups;

  if (referenceType === "quote") {
    // Determine display name: "I" for self-quotes, else author name or "Unknown"
    const displayAuthor = authorName && currentUsername && authorName === currentUsername
      ? "I"
      : (authorName ?? "Unknown");

    // New inline format: [QUOTE: text]
    const match = QUOTE_TOKEN_RE.exec(body);
    if (match) {
      const inlineText = stripSupChars(match[1].trim());
      const before = body.slice(0, match.index);
      const afterStart = match.index + match[0].length;
      const after = body.slice(afterStart);
      return (
        <div style={{ marginTop: 8, fontSize: 15, whiteSpace: "pre-wrap" }}>
          <HighlightableBody
            body={before}
            highlights={highlights}
            currentUserId={currentUserId}
            onDeleteHighlight={onDeleteHighlight}
            bodyStart={0}
            linkify
            color="#adc8d7"
          />
          <blockquote
            className="blockquote-ref"
            onClick={onScrollToRef}
            style={onScrollToRef ? { cursor: "pointer" } : undefined}
            title={onScrollToRef ? "Click to jump to cited response" : undefined}
          >
            <div className="blockquote-author">{displayAuthor} wrote:</div>
            <div className="blockquote-text">"{inlineText}"</div>
          </blockquote>
          <HighlightableBody
            body={after}
            highlights={highlights}
            currentUserId={currentUserId}
            onDeleteHighlight={onDeleteHighlight}
            bodyStart={afterStart}
            linkify
            color="#adc8d7"
          />
        </div>
      );
    }
    // Legacy format: [QUOTE] token with separate quotedText field
    if (quotedText && body.includes("[QUOTE]")) {
      const strippedQuote = stripSupChars(quotedText ?? "");
      const idx = body.indexOf("[QUOTE]");
      const before = body.slice(0, idx);
      const afterStart = idx + "[QUOTE]".length;
      const after = body.slice(afterStart);
      return (
        <div style={{ marginTop: 8, fontSize: 15, whiteSpace: "pre-wrap" }}>
          <HighlightableBody
            body={before}
            highlights={highlights}
            currentUserId={currentUserId}
            onDeleteHighlight={onDeleteHighlight}
            bodyStart={0}
            linkify
            color="#adc8d7"
          />
          <blockquote
            className="blockquote-ref"
            onClick={onScrollToRef}
            style={onScrollToRef ? { cursor: "pointer" } : undefined}
            title={onScrollToRef ? "Click to jump to cited response" : undefined}
          >
            <div className="blockquote-author">{displayAuthor} wrote:</div>
            <div className="blockquote-text">"{strippedQuote}"</div>
          </blockquote>
          <HighlightableBody
            body={after}
            highlights={highlights}
            currentUserId={currentUserId}
            onDeleteHighlight={onDeleteHighlight}
            bodyStart={afterStart}
            linkify
            color="#adc8d7"
          />
        </div>
      );
    }
  }
  // Plain text (no quote reference) — HighlightableBody handles PROMPT tokens
  // and highlight overlays. linkify forwards through to plain-text segments
  // for URL auto-linking, matching the pre-refactor behavior.
  return (
    <div style={{ marginTop: 8, fontSize: 15, whiteSpace: "pre-wrap" }}>
      <HighlightableBody
        body={body}
        highlights={highlights}
        currentUserId={currentUserId}
        onDeleteHighlight={onDeleteHighlight}
        bodyStart={0}
        linkify
        color="#adc8d7"
      />
    </div>
  );
}

export default function RepliesList({
  thread, progressForShow, riskyMode = false,
  likeReply, unlikeReply, likesReplies, likedByUserReplies, focusReplyId, onAuthRequired,
  threadReplyOpen, onThreadReplyClose, onRiskyReveal, onExternalReplyAdded, onReplyDeleted, freshReplyIds, onClickProfile, compactBorders,
  showAheadStubs = false,
  onSetPendingReference, pendingReference, citations, threadCitations, composerRef, onScrollToComposer,
  externalReplies, onRepliesLoaded, refreshKey, groupId, departedUsernames,
  orderMode = "episode",
  hideRespondButtons = false,
  enableHighlights = false,
}: {
  thread: Thread;
  progressForShow?: ViewerProgress;
  riskyMode?: boolean;
  orderMode?: "episode" | "time";
  likeReply: (rid: string, baseCount?: number) => void;
  unlikeReply: (rid: string) => void;
  likesReplies: Record<string, number>;
  likedByUserReplies: Record<string, boolean>;
  focusReplyId?: string | null;
  onAuthRequired: () => void;
  threadReplyOpen?: boolean;
  onThreadReplyClose?: () => void;
  onRiskyReveal?: (rid: string) => void;
  onExternalReplyAdded?: () => void;
  onReplyDeleted?: (rid: string) => void;
  freshReplyIds?: Record<string, true>;
  onClickProfile?: (username: string) => void;
  // New reference system props
  onSetPendingReference?: (ref: PendingReference | null) => void;
  pendingReference?: PendingReference | null;
  citations?: Map<string, CitationEntry[]>;
  threadCitations?: CitationEntry[];
  composerRef?: React.RefObject<HTMLDivElement>;
  onScrollToComposer?: () => void;
  externalReplies?: Reply[];          // externally loaded replies (from parent)
  onRepliesLoaded?: (replies: Reply[]) => void; // notify parent of loaded replies
  refreshKey?: number;               // increment to force a re-fetch
  groupId?: string | null;           // scope replies to this friend room (prevents cross-room duplicates)
  departedUsernames?: Set<string>;   // users who have left the room
  // Suppresses the per-reply "Respond" buttons AND the bottom "Respond
  // to the thread" CTA. V2 (V2InlineThread) opts in so it can render its
  // own single "Write a response" button. V1 leaves this false to keep
  // existing behavior.
  hideRespondButtons?: boolean;
  // V2 uses 2px borders on response cards instead of the V1 default 4px.
  // Applies to both the default state and the green "progressReveal"
  // outline. V2InlineThread opts in; V1 leaves undefined → 4px.
  compactBorders?: boolean;
  // V2 friend rooms render replies above the viewer's progress as
  // non-interactive stubs ("@user responded from episode S## E##.")
  // instead of hiding them. Always-on in V2 (no risky toggle). V1 leaves
  // this undefined → existing hide-or-toggle behavior unchanged.
  showAheadStubs?: boolean;
  // Friend-room reply highlights (the C5/C6 feature). V2 callers opt in by
  // passing true; combined with `groupId` (which signals friend-room
  // context), this gates the per-reply Highlight button + body overlay +
  // picker. V1 callers leave undefined → no Highlight button anywhere,
  // matching the V1 entry surface that also doesn't expose highlights.
  enableHighlights?: boolean;
}) {
  const { user, profile } = useAuth();
  const { scrollTo: scrollHighlight } = useScrollHighlight();

  const [lastVisitAt] = useState<number>(() => {
    const key = `ns_tvisit_${thread.id}`;
    const prev = parseInt(localStorage.getItem(key) || "0", 10);
    localStorage.setItem(key, String(Date.now()));
    return prev;
  });

  const [replies, setReplies] = useState<Reply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRepliesLoading(true);
    fetchRepliesForThread(thread.id, groupId).then(async (data) => {
      if (cancelled) return;
      setReplies(data);
      onRepliesLoaded?.(data);
      setRepliesLoading(false);
    }).catch(() => setRepliesLoading(false));
    return () => { cancelled = true; };
  }, [thread.id, user, refreshKey, groupId]);

  // If parent provides externalReplies (e.g. after a new reply is submitted), merge them in
  useEffect(() => {
    if (!externalReplies) return;
    setReplies(externalReplies);
  }, [externalReplies]);

  const [localLiked, setLocalLiked] = useState<Record<string, boolean>>({});
  const [quoteHintId, setQuoteHintId] = useState<string | null>(null);
  // Link hint: show once on first-ever click; user must click again to use it

  const [localEditedBody, setLocalEditedBody] = useState<Record<string, string>>({});
  const [localDeleted, setLocalDeleted] = useState<Record<string, boolean>>({});
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editReplyBody, setEditReplyBody] = useState("");
  const [editReplySubmitting, setEditReplySubmitting] = useState(false);
  const [editReplyError, setEditReplyError] = useState<string | null>(null);
  // Per-reply body refs so handleStartEditReply can snapshot the rendered
  // body height and apply it as the textarea's initial `height`. Floor at
  // 80px (≈ rows=3 default) so very short replies still get a usable box.
  const replyBodyRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [editStartHeight, setEditStartHeight] = useState<number>(80);
  // Retag warning state: replyId that is pending confirmation
  const [retagWarningReplyId, setRetagWarningReplyId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Highlights state (friend-room only — gated on groupId being set) ───
  // highlightsByReply: keyed on reply id. Locally mutated on optimistic
  // create/delete; bulk-fetched once per visible-reply-set change.
  const [highlightsByReply, setHighlightsByReply] = useState<Record<string, Highlight[]>>({});
  // When non-null, the picker is open for this reply with the captured
  // selection range ready to submit.
  const [highlightPicker, setHighlightPicker] = useState<
    | { replyId: string; anchorRect: DOMRect; start: number; end: number; text: string }
    | null
  >(null);
  // Per-reply inline error (overlap / network) — auto-clears on next action.
  const [highlightError, setHighlightError] = useState<Record<string, string | null>>({});
  // replyId currently showing the empty-selection hint modal, or null.
  const [highlightHint, setHighlightHint] = useState<string | null>(null);
  // Per-reply Highlight-button refs so we can capture anchorRect at click time.
  const highlightBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const byId = useMemo(() => {
    const map: Record<string, Reply> = {};
    for (const r of replies) map[r.id] = r;
    return map;
  }, [replies]);

  // Default render order is by season/episode tag ascending (S00 first), with
  // post time ascending as the tiebreaker within the same tag. Toggling to
  // "time" mode falls back to pure post-time ascending — the order replies
  // are returned by the DB.
  const sortedReplies = useMemo(() => {
    if (orderMode === "time") return replies;
    return [...replies].sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      if (a.episode !== b.episode) return a.episode - b.episode;
      return a.createdAt - b.createdAt;
    });
  }, [replies, orderMode]);

  // "Has been responded to" set for soft-delete tombstone gating.
  // A soft-deleted reply persists as a tombstone iff some other
  // non-deleted reply (or non-deleted citation) references it; otherwise
  // it's filtered out entirely on render. Per user spec 2026-04-25:
  // "the tombstone should not persist on refresh / after navigating
  // away. UNLESS the deleted response has been responded to." Excluding
  // deleted replies from the responder set prevents cascading-delete
  // chains from leaving orphan tombstones.
  const respondedToIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of replies) {
      if (r.isDeleted) continue;
      if (r.replyToId) ids.add(r.replyToId);
      if (r.referencedReplyId) ids.add(r.referencedReplyId);
    }
    if (citations) {
      // Citations whose citing reply is itself non-deleted count too.
      for (const [citedId, entries] of citations) {
        const hasVisibleCiter = entries.some(e => {
          const cr = byId[e.citingReplyId];
          return cr && !cr.isDeleted;
        });
        if (hasVisibleCiter) ids.add(citedId);
      }
    }
    return ids;
  }, [replies, citations, byId]);

  const [revealed, setRevealed] = useState<Record<string, true>>({});
  const [progressReveal, setProgressReveal] = useState<Record<string, true>>(() => freshReplyIds ?? {});
  const [promptFor, setPromptFor] = useState<Reply | null>(null);

  const prevProgRef = useRef<ViewerProgress | undefined>(progressForShow);
  useEffect(() => {
    const prev = prevProgRef.current;
    const cur = progressForShow;
    if (prev && cur && (prev.s !== cur.s || prev.e !== cur.e)) {
      const updates: Record<string, true> = {};
      for (const r of replies) {
        const was = canView({ season: r.season, episode: r.episode }, prev);
        const now = canView({ season: r.season, episode: r.episode }, cur);
        if (!was && now) updates[r.id] = true;
      }
      if (Object.keys(updates).length) setProgressReveal(pr => ({ ...pr, ...updates }));
    }
    prevProgRef.current = cur;
  }, [progressForShow, replies]);

  // ── Highlights bulk-fetch ─────────────────────────────────────────────
  // Only fetches when highlights are enabled (V2 caller) AND in friend-room
  // context (groupId set). The Highlight button appears under the same
  // condition, so V1 callers + non-friend-room contexts have a clean no-op.
  const highlightsEnabled = !!enableHighlights && !!groupId;
  const replyIdsKey = useMemo(() => replies.map(r => r.id).sort().join(","), [replies]);
  useEffect(() => {
    if (!highlightsEnabled) {
      setHighlightsByReply({});
      return;
    }
    const ids = replies.map(r => r.id);
    if (ids.length === 0) {
      setHighlightsByReply({});
      return;
    }
    let cancelled = false;
    dbFetchHighlights({
      targetType: "reply",
      targetIds: ids,
      viewerProgress: progressForShow,
    })
      .then((rows) => {
        if (cancelled) return;
        const byReply: Record<string, Highlight[]> = {};
        for (const h of rows) {
          (byReply[h.targetId] ??= []).push(h);
        }
        setHighlightsByReply(byReply);
      });
    return () => { cancelled = true; };
  }, [highlightsEnabled, replyIdsKey, progressForShow]);

  // ── Highlight handlers (reply-scoped) ─────────────────────────────────
  const handleHighlightClickReply = (replyId: string) => {
    if (!user) {
      onAuthRequired();
      return;
    }
    // Scope the selection to THIS reply's body — without this, a selection
    // inside another reply would get captured and attached to this reply.
    const sel = selectionToBodyOffsets(replyBodyRefs.current[replyId]);
    if (!sel) {
      setHighlightHint(replyId);
      return;
    }
    const rect = highlightBtnRefs.current[replyId]?.getBoundingClientRect();
    if (!rect) return;
    setHighlightError((prev) => ({ ...prev, [replyId]: null }));
    setHighlightPicker({ replyId, anchorRect: rect, start: sel.start, end: sel.end, text: sel.text });
  };

  const handleHighlightConfirmReply = async (
    payload: { kind: "yup" } | { kind: "note"; note: string },
  ) => {
    if (!highlightPicker || !groupId) return;
    const { replyId, start, end, text } = highlightPicker;
    // Snapshot the viewer's effective progress as the highlight's spoiler tag.
    // Fall back to the reply's own season/episode (the lowest valid floor:
    // the viewer must be at-or-past that to see the reply at all).
    const eff = effectiveProgress(progressForShow);
    const replyRow = byId[replyId];
    const authorSeason  = eff?.s ?? replyRow?.season ?? 0;
    const authorEpisode = eff?.e ?? replyRow?.episode ?? 0;
    try {
      const inserted = await dbCreateHighlight({
        targetType:    "reply",
        targetId:      replyId,
        groupId,
        startOffset:   start,
        endOffset:     end,
        quotedText:    text,
        kind:          payload.kind,
        note:          payload.kind === "note" ? payload.note : null,
        authorSeason,
        authorEpisode,
      });
      setHighlightsByReply((prev) => ({
        ...prev,
        [replyId]: [...(prev[replyId] ?? []), inserted],
      }));
      setHighlightPicker(null);
      setHighlightError((prev) => ({ ...prev, [replyId]: null }));
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "Couldn't save highlight.";
      setHighlightError((prev) => ({ ...prev, [replyId]: msg }));
      setHighlightPicker(null);
    }
  };

  const handleDeleteHighlightReply = (replyId: string, highlightId: string) => {
    const snapshot = highlightsByReply[replyId] ?? [];
    setHighlightsByReply((prev) => ({
      ...prev,
      [replyId]: (prev[replyId] ?? []).filter(h => h.id !== highlightId),
    }));
    dbDeleteHighlight(highlightId).catch((e) => {
      console.warn("deleteHighlight (reply) failed:", e);
      setHighlightsByReply((prev) => ({ ...prev, [replyId]: snapshot }));
      setHighlightError((prev) => ({ ...prev, [replyId]: "Couldn't remove highlight." }));
    });
  };

  const canSeeSelf = (r: Reply) => canView({ season: r.season, episode: r.episode }, progressForShow);

  // Writer's current *effective* progress for edit-retag purposes — highest
  // for rewatchers, raw .s/.e otherwise. See InlineThreadView's comment for
  // the rationale (rewatchers must re-tag at their spoiler ceiling, not
  // their rewatch position).
  const editTag = effectiveProgress(progressForShow);

  // Walk up the reply-parent chain. Parent can be either the legacy
  // replyToId (reply-to-reply threading) or the modern referencedReplyId
  // (quote / link reference set by the composer). Current UI only sets
  // referencedReplyId, so walking only replyToId — which was the prior
  // behavior — meant orphan-hiding never actually fired for real replies.
  const getParentReply = (r: Reply): Reply | null =>
    (r.replyToId && byId[r.replyToId]) || (r.referencedReplyId && byId[r.referencedReplyId]) || null;

  const isAncestorRedacted = (r: Reply): boolean => {
    let cur = getParentReply(r);
    while (cur) {
      const curWithin = canSeeSelf(cur);
      const curRevealed = !!revealed[cur.id];
      if (!riskyMode) {
        if (!curWithin) return true;
      } else {
        if (!curWithin && !curRevealed) return true;
      }
      cur = getParentReply(cur);
    }
    return false;
  };

  const isVisible = (r: Reply): { show: boolean; redacted: boolean } => {
    const within = canSeeSelf(r);
    const parentRedacted = isAncestorRedacted(r);

    if (!riskyMode) {
      if (!within || parentRedacted) return { show: false, redacted: false };
      return { show: true, redacted: false };
    } else {
      const needRedact = (!within || parentRedacted) && !revealed[r.id];
      return { show: !needRedact, redacted: needRedact };
    }
  };

  const scrollTo = (replyId: string, flash = false) => {
    const el = document.getElementById(`reply-${replyId}`) ?? document.getElementById(`c-${replyId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (flash) afterScroll().then(() => flashEl(el));
  };

  const replyLabel = (r: Reply) =>
    `This viewer has watched S${String(r.season).padStart(2, "0")} E${String(r.episode).padStart(2, "0")}. Click to reveal.`;

  const handleLikeReply = async (rid: string) => {
    if (!user) { onAuthRequired(); return; }
    const alreadyLiked = likedByUserReplies[rid] || localLiked[rid];
    if (alreadyLiked) {
      unlikeReply(rid);
      setLocalLiked((prev) => { const n = { ...prev }; delete n[rid]; return n; });
      try {
        await dbUnlikeReply(user.id, rid);
      } catch (err) {
        console.error("Failed to unlike reply:", err);
        setLocalLiked((prev) => ({ ...prev, [rid]: true }));
      }
      return;
    }
    const reply = replies.find(r => r.id === rid);
    const baseCount = likesReplies[rid] ?? reply?.likes ?? 0;
    likeReply(rid, baseCount);
    setLocalLiked((prev) => ({ ...prev, [rid]: true }));
    try {
      await dbLikeReply(user.id, rid);
    } catch (err) {
      console.error("Failed to like reply:", err);
      setLocalLiked((prev) => { const n = { ...prev }; delete n[rid]; return n; });
    }
  };

  const handleStartEditReply = (r: Reply) => {
    const measured = replyBodyRefs.current[r.id]?.offsetHeight ?? 0;
    setEditStartHeight(Math.max(80, measured));
    setEditingReplyId(r.id);
    setEditReplyBody(localEditedBody[r.id] ?? r.body);
    setEditReplyError(null);
  };

  const handleCancelEditReply = () => {
    setEditingReplyId(null);
    setEditReplyBody("");
    setEditReplyError(null);
  };

  const handleSaveEditReply = async (rid: string, confirmed = false) => {
    const body = editReplyBody.trim();
    if (!body) return;
    const original = byId[rid];
    // Determine the tag this edit will use (writer's current effective progress)
    const tagS = editTag?.s ?? original?.season ?? 1;
    const tagE = editTag?.e ?? original?.episode ?? 1;
    const advanced = original && editTag != null &&
      (editTag.s > original.season ||
        (editTag.s === original.season && editTag.e > original.episode));
    // If progress has advanced, show warning first (unless already confirmed)
    if (advanced && !confirmed) {
      setRetagWarningReplyId(rid);
      return;
    }
    setRetagWarningReplyId(null);
    setEditReplySubmitting(true);
    setEditReplyError(null);
    try {
      await dbEditReply(rid, body, tagS, tagE);
      setLocalEditedBody(prev => ({ ...prev, [rid]: body }));
      setReplies(prev => prev.map(r => r.id === rid ? { ...r, body, season: tagS, episode: tagE, isEdited: true } : r));
      // Refetch highlights for this reply — editReply runs the
      // reanchor_highlights_for_target RPC server-side, but our
      // highlightsByReply state still has the pre-edit offsets and would
      // render at wrong positions (or be filtered out by the segment-bounds
      // check) until next mount. Only when highlights are enabled for this
      // RepliesList instance (V2 friend rooms).
      if (highlightsEnabled) {
        dbFetchHighlights({
          targetType: "reply",
          targetIds: [rid],
          viewerProgress: progressForShow,
        }).then((fresh) => {
          setHighlightsByReply(prev => ({ ...prev, [rid]: fresh }));
        });
      }
      setEditingReplyId(null);
    } catch (e: any) {
      setEditReplyError(e?.message ?? "Failed to save. Please try again.");
    } finally {
      setEditReplySubmitting(false);
    }
  };

  const handleDeleteReply = async (rid: string) => {
    setDeleteConfirmId(null);
    try {
      await dbDeleteReply(rid);
      setLocalDeleted(prev => ({ ...prev, [rid]: true }));
      setReplies(prev => prev.map(r => r.id === rid ? { ...r, isDeleted: true } : r));
      onReplyDeleted?.(rid);
    } catch {
      setDeleteError("Failed to delete. Please try again.");
    }
  };

  // Handle Quote action on a reply
  const handleQuote = (r: Reply) => {
    if (!user) { onAuthRequired(); return; }
    const sel = window.getSelection();
    const selectedText = sel?.toString().trim() ?? "";
    if (!selectedText) {
      // No text selected — show the hint popup instead
      setQuoteHintId(id => id === r.id ? null : r.id);
      return;
    }
    setQuoteHintId(null);
    onSetPendingReference?.({
      type: "quote",
      replyId: r.id,
      authorName: r.author,
      quotedText: selectedText,
    });
    onScrollToComposer?.();
  };

  // Handle Link action on a reply. The one-time explainer modal was
  // removed along with the "link" nomenclature — the feature still works
  // the same way, we just don't pop an explainer on first use anymore.
  const handleLink = (r: Reply) => {
    if (!user) { onAuthRequired(); return; }
    onSetPendingReference?.({
      type: "link",
      replyId: r.id,
      authorName: r.author,
    });
    onScrollToComposer?.();
  };

  useEffect(() => {
    if (!focusReplyId) return;
    // Poll until the element exists in the DOM (replies may still be loading).
    // Retries every 80ms for up to ~3 seconds before giving up.
    let attempts = 0;
    const MAX = 38;
    let timerId: ReturnType<typeof setTimeout>;
    const tryScroll = () => {
      const el = document.getElementById(`reply-${focusReplyId}`) ?? document.getElementById(`c-${focusReplyId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        afterScroll().then(() => flashEl(el));
        return;
      }
      if (++attempts < MAX) timerId = setTimeout(tryScroll, 80);
    };
    timerId = setTimeout(tryScroll, 80);
    return () => clearTimeout(timerId);
  }, [focusReplyId]);

  return (
    <>
      {highlightPicker && (
        <HighlightPicker
          anchorRect={highlightPicker.anchorRect}
          onClose={() => setHighlightPicker(null)}
          onConfirm={handleHighlightConfirmReply}
          color="#adc8d7"
        />
      )}

      {highlightHint && (
        <Modal onClose={() => setHighlightHint(null)} width="min(520px,92vw)" cardClassName="explanation-card">
          <div style={{ padding: "16px 12px 12px" }}>
            <p style={{ margin: "0 0 32px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              Want to react to something quickly? Highlight a portion of text then click the "Highlight..." button.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn" style={{ fontSize: 15, padding: "8px 24px" }} onClick={() => setHighlightHint(null)}>Got it</button>
            </div>
          </div>
        </Modal>
      )}

      {quoteHintId && (
        <Modal onClose={() => setQuoteHintId(null)} width="min(520px,92vw)" cardClassName="explanation-card">
          <div style={{ padding: "16px 12px 12px" }}>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              <MessageSquare size={14} color="currentColor" /> Highlight the portion of any entry that you'd like to respond to, then click the Quote button. This will open a new response where you can add your thoughts — your quotation will link back to this entry and vice-versa.
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              The thread stays linear, but the connections between ideas are visible.
            </p>
            <p style={{ margin: "0 0 32px", fontSize: 15, lineHeight: 1.6, opacity: 0.65, fontStyle: "italic" }}>
              This might feel confusing, but try it out! You can always edit your response after you post it.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn" style={{ fontSize: 15, padding: "8px 24px" }} onClick={() => setQuoteHintId(null)}>Got it</button>
            </div>
          </div>
        </Modal>
      )}

{promptFor && riskyMode && (
        <Modal onClose={() => setPromptFor(null)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <h3 className="title" style={{ margin: 0 }}>Are you sure?</h3>
            <button className="close-x" onClick={() => setPromptFor(null)}><X size={14} /></button>
          </div>
          <p className="muted" style={{ marginTop: 6 }}>This person is replying to an episode you've watched, BUT they're further along in the show. <br /><br />There may be spoilers ahead!</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button className="btn btn-danger" onClick={() => setPromptFor(null)}>Nevermind</button>
            <button
              className="btn btn-danger"
              onClick={() => {
                if (!promptFor) return;
                const id = promptFor.id;
                setRevealed((r) => ({ ...r, [id]: true }));
                onRiskyReveal?.(id);
                setPromptFor(null);
                setTimeout(() => scrollTo(id, true), 0);
              }}
            >
              I'll risk it.
            </button>
          </div>
        </Modal>
      )}

      {deleteConfirmId && (
        <Modal onClose={() => setDeleteConfirmId(null)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <h3 className="title" style={{ margin: 0 }}>Delete this response?</h3>
            <button className="close-x" onClick={() => setDeleteConfirmId(null)}><X size={14} /></button>
          </div>
          <p className="muted" style={{ marginTop: 6 }}>If anyone has responded to it, it'll stay as a stub so the chain remains readable. Otherwise it'll vanish entirely. This can't be undone.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button className="btn" onClick={() => setDeleteConfirmId(null)}>Nevermind</button>
            <button
              className="btn btn-danger"
              onClick={() => handleDeleteReply(deleteConfirmId)}
            >
              Delete it
            </button>
          </div>
        </Modal>
      )}

      {deleteError && (
        <Modal onClose={() => setDeleteError(null)}>
          <p style={{ marginTop: 0 }}>{deleteError}</p>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn" onClick={() => setDeleteError(null)}>OK</button>
          </div>
        </Modal>
      )}

      {repliesLoading && <div className="muted" style={{ fontSize: 14 }}>Loading replies<LoadingDots /></div>}
      <div style={{ display: "grid", gap: 12 }}>
        {sortedReplies.map((r) => {
          const isReplyDeleted = r.isDeleted || !!localDeleted[r.id];
          const isReplyEdited = r.isEdited;
          const isReplyOwn = !!profile && r.author === profile.username;

          // Soft-delete handling: only persist as a tombstone if someone
          // has responded to the deleted reply (chain preservation).
          // Otherwise filter entirely so the reply truly vanishes on
          // refresh. See respondedToIds construction above for the rule.
          // localDeleted[r.id] (optimistic UI flag) always renders as a
          // tombstone too — keeps the just-clicked-delete UX feedback
          // consistent before the refetch lands and the rule applies.
          if (isReplyDeleted) {
            if (!respondedToIds.has(r.id) && !localDeleted[r.id]) return null;
            return (
              <div
                key={r.id}
                id={`reply-${r.id}`}
                className="card"
                style={{ marginLeft: 8, opacity: 0.45, borderLeft: "4px solid var(--dos-border)" }}
              >
                <span className="muted" style={{ fontSize: 14 }}>
                  (@{r.author}) deleted their reply.
                </span>
              </div>
            );
          }

          const vis = isVisible(r);

          // V2 "ahead-of-progress" stub: when showAheadStubs is on AND
          // the reply itself is above the viewer's progress (NOT just
          // ancestor-redacted), render a non-interactive stub rather than
          // hiding the reply. Orphans (visible reply, hidden parent)
          // continue to be hidden via the regular vis.show check — the
          // monotonic progress-tagging rule means orphans don't exist in
          // practice anyway.
          if (showAheadStubs && !riskyMode && !vis.show && !canSeeSelf(r)) {
            const tag = `S${r.season} E${r.episode}`;
            return (
              <div
                key={r.id}
                id={`reply-${r.id}`}
                className="card redacted"
                style={{
                  marginLeft: 8,
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  minHeight: 32,
                  padding: "4px 14px",
                  cursor: "default",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>
                  {r.author} responded from episode {tag}.
                </div>
              </div>
            );
          }

          if (!riskyMode && !vis.show) return null;

          if (riskyMode && vis.redacted) {
            return (
              <div
                key={r.id}
                id={`reply-${r.id}`}
                className="card redacted"
                onClick={() => setPromptFor(r)}
                style={{ marginLeft: 8, cursor: "pointer", display: "flex", alignItems: "center", minHeight: 32, padding: "4px 10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                title="Click to reveal — may contain spoilers"
              >
                <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1 }}>
                  {replyLabel(r)}
                </div>
              </div>
            );
          }

          const isCurrentlyEditing = editingReplyId === r.id;
          const isNewReply = lastVisitAt > 0 && r.updatedAt > lastVisitAt && !isReplyOwn;
          const likeCt = likesReplies[r.id] ?? r.likes;
          const userLiked = likedByUserReplies[r.id] || !!localLiked[r.id];

          // Lookup referenced reply/thread for display
          const referencedReply = r.referencedReplyId ? byId[r.referencedReplyId] : null;
          const replyCitations = citations?.get(r.id) ?? [];

          // Split citations into quote (inline in body) and link (in header).
          // Each group is numbered independently starting at 1.
          // Only show citations where the citing reply is visible to this viewer.
          const quoteSups: SupEntry[] = replyCitations
            .filter(c => {
              const cr = byId[c.citingReplyId];
              return cr && !cr.isDeleted && canSeeSelf(cr) && cr.referenceType === 'quote' && !!cr.quotedText;
            })
            .map((c, i) => ({
              index: i + 1,
              citedText: (byId[c.citingReplyId].quotedText ?? "").replace(/…$/, "").trim(),
              onScrollTo: () => scrollHighlight(`reply-${c.citingReplyId}`),
            }))
            .filter(s => s.citedText.length >= 4);

          const linkSups = replyCitations
            .filter(c => {
              const cr = byId[c.citingReplyId];
              return cr && !cr.isDeleted && canSeeSelf(cr) && cr.referenceType === 'link';
            })
            .map((c, i) => ({
              index: i + 1,
              onScrollTo: () => scrollHighlight(`reply-${c.citingReplyId}`),
            }));

          return (
            <div
              key={r.id}
              id={`reply-${r.id}`}
              className="card reply-card"
              style={{
                border: (() => {
                  const w = compactBorders ? 2 : 4;
                  return progressReveal[r.id]
                    ? `${w}px solid #4b8f6c`
                    : `${w}px solid var(--dos-border)`;
                })(),
                marginLeft: 8,
                position: "relative",
                color: "var(--dos-bg)",
                ["--dos-accent" as any]: "var(--dos-bg)",
                ["--dos-cyan" as any]: "var(--dos-bg)",
                ["--dos-gray" as any]: "rgba(222,168,56,0.65)",
              }}
            >
              {isNewReply && (
                <div style={{ position: "absolute", left: -10, top: -10, width: 20, height: 20, borderRadius: "50%", background: "var(--green)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", zIndex: 2, pointerEvents: "none" }} />
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "2px 6px" }}>
                <div style={{ fontSize: 14, display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0 6px" }}>
                  <Username name={r.author} onClickProfile={onClickProfile ?? (() => {})} bold />
                  {groupId && departedUsernames?.has(r.author) && (
                    <span style={{ fontStyle: "italic", fontSize: 12, opacity: 0.6 }}>has left the room</span>
                  )}
                  {thread.showId !== "simshow" && (
                    <span style={{ color: "var(--dos-cyan)", fontWeight: 700 }}>
                      <EpisodeTag
                        season={r.season}
                        episode={r.episode}
                        isRewatch={r.isRewatch}
                        rewatchS={r.rewatchS}
                        rewatchE={r.rewatchE}
                        parens={false}
                        naturalNumbers
                      />
                    </span>
                  )}
                  {isReplyEdited && (
                    <span style={{ fontStyle: "italic", fontSize: 12, opacity: 0.7 }}>(edited)</span>
                  )}
                  {/* "Responding to" inline for link-type references */}
                  {r.referenceType === "link" && (referencedReply || r.referencedThreadId) && (
                    <button
                      className="responding-to-label"
                      style={{ fontSize: 13 }}
                      onClick={() =>
                        r.referencedReplyId
                          ? scrollHighlight(`reply-${r.referencedReplyId}`)
                          : scrollHighlight("thread-entry")
                      }
                    >
                      · responding to {referencedReply ? referencedReply.author : thread.author}
                    </button>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{timeAgo(r.updatedAt)}</div>
              </div>

              {isCurrentlyEditing ? (
                <div style={{ marginTop: 8 }}>
                  {/* Styled to match ResponseComposer's write-response UI:
                     white textarea, var(--danger) red buttons regardless of
                     context. Previously used .edit-textarea class + .btn
                     primary, which picked up public-context green
                     overrides (theme.ts public-context block) and rendered
                     inconsistently with the write box alongside it. */}
                  <textarea
                    value={editReplyBody}
                    onChange={e => setEditReplyBody(e.target.value)}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "#fff", color: "#000",
                      border: "none", borderRadius: 8,
                      padding: "8px 10px", fontSize: 14, resize: "vertical",
                      fontFamily: "inherit",
                      height: editStartHeight,
                    }}
                    autoFocus
                  />
                  {editReplyError && (
                    <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 4 }}>{editReplyError}</div>
                  )}
                  {retagWarningReplyId === r.id ? (
                    <div className="retag-warning" style={{ background: "var(--dos-bg)", border: "1px solid var(--dos-border)", borderRadius: 24, padding: "12px 14px", marginTop: 8, fontSize: 13 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Heads up — this reply will be retagged</div>
                      <div style={{ opacity: 0.85, marginBottom: 10 }}>
                        Your progress has moved to{" "}
                        <strong>S{String(editTag?.s ?? r.season).padStart(2,"0")} E{String(editTag?.e ?? r.episode).padStart(2,"0")}</strong>.
                        {" "}Saving will retag this reply to your current progress — readers below that point who could see it before will no longer see it.
                      </div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        {/* No .btn className — the `.reply-card .btn:not(.btn-danger)`
                            override in theme.ts forces transparent/dos-bg colors via
                            !important, making these buttons invisible against the
                            warning card's light-blue. Inline the layout properties
                            .btn would have provided. */}
                        <button
                          onClick={() => setRetagWarningReplyId(null)}
                          disabled={editReplySubmitting}
                          style={{
                            background: "transparent",
                            border: "2px solid #fff",
                            color: "#fff",
                            borderRadius: 9999,
                            padding: "6px 12px",
                            cursor: "pointer",
                            fontWeight: 500,
                            fontFamily: "inherit",
                            fontSize: 13,
                          }}
                        >
                          Go back
                        </button>
                        <button
                          onClick={() => handleSaveEditReply(r.id, true)}
                          disabled={editReplySubmitting}
                          style={{
                            background: "transparent",
                            border: "2px solid var(--danger)",
                            color: "var(--danger)",
                            borderRadius: 9999,
                            padding: "6px 12px",
                            cursor: "pointer",
                            fontWeight: 500,
                            fontFamily: "inherit",
                            fontSize: 13,
                          }}
                        >
                          {editReplySubmitting ? "Saving…" : "Save & retag"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
                      <button
                        className="btn"
                        onClick={handleCancelEditReply}
                        disabled={editReplySubmitting}
                        style={{ background: "transparent", border: "2px solid var(--danger)", color: "var(--danger)" }}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn"
                        onClick={() => handleSaveEditReply(r.id)}
                        disabled={editReplySubmitting || !editReplyBody.trim()}
                        style={{ background: "var(--danger)", border: "2px solid var(--danger)", color: "#fff" }}
                      >
                        {editReplySubmitting ? "Saving…" : "Save"}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div ref={el => { replyBodyRefs.current[r.id] = el; }}>
                  <ReplyBody
                    body={r.body}
                    quotedText={r.quotedText}
                    authorName={referencedReply?.author ?? (r.referencedThreadId ? thread.author : null)}
                    currentUsername={profile?.username ?? null}
                    referenceType={r.referenceType}
                    onScrollToRef={
                      r.referencedReplyId
                        ? () => scrollHighlight(`reply-${r.referencedReplyId}`)
                        : r.referencedThreadId
                          ? () => scrollHighlight("thread-entry")
                          : undefined
                    }
                    highlights={highlightsEnabled ? (highlightsByReply[r.id] ?? []) : []}
                    currentUserId={user?.id ?? null}
                    onDeleteHighlight={highlightsEnabled ? (hid) => handleDeleteHighlightReply(r.id, hid) : undefined}
                  />
                  {highlightsEnabled && highlightError[r.id] && (
                    <div style={{ fontSize: 12, color: "#f45028", marginTop: 6, fontStyle: "italic" }}>
                      {highlightError[r.id]}
                    </div>
                  )}
                </div>
              )}

              {!isCurrentlyEditing && (
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <LikeBadge
                    count={likeCt}
                    userLiked={userLiked}
                    onClick={() => handleLikeReply(r.id)}
                    title="this post!"
                    inReply
                  />
                  {isReplyOwn && (
                    <>
                      <button className="btn" style={{ fontSize: 13 }} onClick={() => handleStartEditReply(r)}>Edit</button>
                      <button className="btn btn-danger" style={{ fontSize: 13 }} onClick={() => setDeleteConfirmId(r.id)}>Delete</button>
                    </>
                  )}
                  {highlightsEnabled && (
                    <button
                      ref={el => { highlightBtnRefs.current[r.id] = el; }}
                      onClick={() => handleHighlightClickReply(r.id)}
                      style={{
                        fontSize: 13,
                        padding: "3px 12px",
                        background: "#adc8d7",
                        color: "#fff",
                        border: "2px solid #adc8d7",
                        borderRadius: 9999,
                        cursor: "pointer",
                        fontWeight: 500,
                        fontFamily: "inherit",
                      }}
                    >
                      Highlight…
                    </button>
                  )}
                  <div style={{ position: "relative", display: "inline-block" }}>
                    <button
                      className="btn"
                      style={{ fontSize: 13 }}
                      onClick={() => handleQuote(r)}
                      title="Quote this response"
                    >
                      Quote…
                    </button>
                  </div>
                  {!hideRespondButtons && (
                    <button
                      className="btn"
                      style={{ fontSize: 13 }}
                      onClick={() => handleLink(r)}
                      title="Respond"
                    >
                      Respond
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* "Respond to the thread" button at the very bottom — only shown when
         at least one reply is actually rendered. Matches the render logic
         above: deleted stubs always show, others are gated by isVisible.
         A friend-room thread with seed replies that don't pass the group or
         progress filter should show no button — the in-entry "Write a
         response" button is the sole entry point in that case. */}
      {!hideRespondButtons && replies.some(r => (r.isDeleted || !!localDeleted[r.id]) || isVisible(r).show) && (
        <div style={{ marginTop: 40, display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn"
            style={{ fontSize: 17, padding: "10px 22px" }}
            onClick={() => {
              if (!user) { onAuthRequired(); return; }
              onScrollToComposer?.();
            }}
          >
            Respond to the thread
          </button>
        </div>
      )}
    </>
  );
}
