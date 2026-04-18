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
import type { CitationEntry } from "../lib/db";
import { fetchRepliesForThread, likeReply as dbLikeReply, unlikeReply as dbUnlikeReply, editReply as dbEditReply, deleteReply as dbDeleteReply } from "../lib/db";
import { useAuth } from "../lib/auth";
import { canView, timeAgo, type ViewerProgress } from "../lib/utils";
import EpisodeTag from "./EpisodeTag";
import Modal from "./Modal";
import LikeBadge from "./LikeBadge";
import Username from "./Username";
import Tooltip from "./Tooltip";
import type { PendingReference } from "./ResponseComposer";
import { useScrollHighlight } from "../hooks/useScrollHighlight";

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
  if (!markers.length) return { nodes: [text], matchedIndices };
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
  return { nodes, matchedIndices };
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
}: {
  body: string;
  quotedText?: string | null;
  authorName?: string | null;
  currentUsername?: string | null;
  referenceType?: string | null;
  onScrollToRef?: () => void;
  quoteSups?: SupEntry[];
}) {
  if (referenceType === "quote") {
    // Determine display name: "I" for self-quotes, else author name or "Unknown"
    const displayAuthor = authorName && currentUsername && authorName === currentUsername
      ? "I"
      : (authorName ?? "Unknown");

    // New inline format: [QUOTE: text]
    const match = QUOTE_TOKEN_RE.exec(body);
    if (match) {
      const inlineText = stripSupChars(match[1].trim());
      const parts = body.split(QUOTE_TOKEN_RE);
      const before = parts[0] ?? "";
      const after = parts.slice(2).join("") ?? "";
      const { nodes: beforeNodes, matchedIndices: bm } = annotateTextWithSups(before, quoteSups);
      const afterBefore = quoteSups.filter(s => !bm.has(s.index));
      const { nodes: quoteNodes, matchedIndices: qm } = annotateTextWithSups(inlineText, afterBefore);
      const afterQuote = afterBefore.filter(s => !qm.has(s.index));
      const { nodes: afterNodes, matchedIndices: am } = annotateTextWithSups(after, afterQuote);
      const unmatched = afterQuote.filter(s => !am.has(s.index));
      return (
        <div style={{ marginTop: 8, fontSize: 15, whiteSpace: "pre-wrap" }}>
          {beforeNodes}
          <blockquote
            className="blockquote-ref"
            onClick={onScrollToRef}
            style={onScrollToRef ? { cursor: "pointer" } : undefined}
            title={onScrollToRef ? "Click to jump to cited response" : undefined}
          >
            <div className="blockquote-author">{displayAuthor} wrote:</div>
            <div className="blockquote-text">"{quoteNodes}"</div>
          </blockquote>
          {afterNodes}
          <UnmatchedSups sups={unmatched} />
        </div>
      );
    }
    // Legacy format: [QUOTE] token with separate quotedText field
    if (quotedText && body.includes("[QUOTE]")) {
      const strippedQuote = stripSupChars(quotedText ?? "");
      const parts = body.split("[QUOTE]");
      const before = parts[0] ?? "";
      const after = parts.slice(1).join("[QUOTE]");
      const { nodes: beforeNodes, matchedIndices: bm } = annotateTextWithSups(before, quoteSups);
      const afterBefore = quoteSups.filter(s => !bm.has(s.index));
      const { nodes: quoteNodes, matchedIndices: qm } = annotateTextWithSups(strippedQuote, afterBefore);
      const afterQuote = afterBefore.filter(s => !qm.has(s.index));
      const { nodes: afterNodes, matchedIndices: am } = annotateTextWithSups(after, afterQuote);
      const unmatched = afterQuote.filter(s => !am.has(s.index));
      return (
        <div style={{ marginTop: 8, fontSize: 15, whiteSpace: "pre-wrap" }}>
          {beforeNodes}
          <blockquote
            className="blockquote-ref"
            onClick={onScrollToRef}
            style={onScrollToRef ? { cursor: "pointer" } : undefined}
            title={onScrollToRef ? "Click to jump to cited response" : undefined}
          >
            <div className="blockquote-author">{displayAuthor} wrote:</div>
            <div className="blockquote-text">"{quoteNodes}"</div>
          </blockquote>
          {afterNodes}
          <UnmatchedSups sups={unmatched} />
        </div>
      );
    }
  }
  // Plain text — first split on PROMPT tokens, then annotate remaining text with sups
  const promptParts = parsePromptTokens(body);
  const renderedParts: React.ReactNode[] = [];
  let unmatchedSups: SupEntry[] = [...quoteSups];
  let partKeyIdx = 0;
  for (const part of promptParts) {
    if (typeof part === "string") {
      const { nodes, matchedIndices } = annotateTextWithSups(part, unmatchedSups);
      unmatchedSups = unmatchedSups.filter(s => !matchedIndices.has(s.index));
      renderedParts.push(...nodes.map((n, i) => <React.Fragment key={`pp-${partKeyIdx}-${i}`}>{n}</React.Fragment>));
    } else {
      renderedParts.push(<React.Fragment key={`pf-${partKeyIdx}`}>{part}</React.Fragment>);
    }
    partKeyIdx++;
  }
  const unmatched = unmatchedSups;
  return (
    <div style={{ marginTop: 8, fontSize: 15, whiteSpace: "pre-wrap" }}>
      {renderedParts}
      <UnmatchedSups sups={unmatched} />
    </div>
  );
}

export default function RepliesList({
  thread, progressForShow, riskyMode = false,
  likeReply, unlikeReply, likesReplies, likedByUserReplies, focusReplyId, onAuthRequired,
  threadReplyOpen, onThreadReplyClose, onRiskyReveal, onExternalReplyAdded, onReplyDeleted, freshReplyIds, onClickProfile,
  onSetPendingReference, pendingReference, citations, threadCitations, composerRef, onScrollToComposer,
  externalReplies, onRepliesLoaded, refreshKey, groupId, departedUsernames,
}: {
  thread: Thread;
  progressForShow?: ViewerProgress;
  riskyMode?: boolean;
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
  const [linkHintPending, setLinkHintPending] = useState(false);
  const [linkPendingReply, setLinkPendingReply] = useState<Reply | null>(null);

  const [localEditedBody, setLocalEditedBody] = useState<Record<string, string>>({});
  const [localDeleted, setLocalDeleted] = useState<Record<string, boolean>>({});
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editReplyBody, setEditReplyBody] = useState("");
  const [editReplySubmitting, setEditReplySubmitting] = useState(false);
  const [editReplyError, setEditReplyError] = useState<string | null>(null);
  // Retag warning state: replyId that is pending confirmation
  const [retagWarningReplyId, setRetagWarningReplyId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const byId = useMemo(() => {
    const map: Record<string, Reply> = {};
    for (const r of replies) map[r.id] = r;
    return map;
  }, [replies]);

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

  const canSeeSelf = (r: Reply) => canView({ season: r.season, episode: r.episode }, progressForShow);

  const isAncestorRedacted = (r: Reply): boolean => {
    let cur = r.replyToId ? byId[r.replyToId] : null;
    while (cur) {
      const curWithin = canSeeSelf(cur);
      const curRevealed = !!revealed[cur.id];
      if (!riskyMode) {
        if (!curWithin) return true;
      } else {
        if (!curWithin && !curRevealed) return true;
      }
      cur = cur.replyToId ? byId[cur.replyToId] : null;
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
    // Determine the tag this edit will use (writer's current progress)
    const tagS = progressForShow?.s ?? original?.season ?? 1;
    const tagE = progressForShow?.e ?? original?.episode ?? 1;
    const advanced = original && progressForShow != null &&
      (progressForShow.s > original.season ||
        (progressForShow.s === original.season && progressForShow.e > original.episode));
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

  // Handle Link action on a reply
  const handleLink = (r: Reply) => {
    if (!user) { onAuthRequired(); return; }
    // Show one-time explanation on first-ever click; store reply to execute after "Got it"
    if (!localStorage.getItem("ns_link_hint_seen")) {
      setLinkPendingReply(r);
      setLinkHintPending(true);
      return;
    }
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

      {linkHintPending && (
        <Modal onClose={() => setLinkHintPending(false)} width="min(520px,92vw)" cardClassName="explanation-card">
          <div style={{ padding: "16px 12px 12px" }}>
            <p style={{ margin: "0 0 32px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              <Link2 size={14} color="currentColor" /> Linking connects your response back to this entry. Your post will link back here and vice versa.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn"
                style={{ fontSize: 15, padding: "8px 24px" }}
                onClick={() => {
                  localStorage.setItem("ns_link_hint_seen", "1");
                  setLinkHintPending(false);
                  if (linkPendingReply) {
                    onSetPendingReference?.({
                      type: "link",
                      replyId: linkPendingReply.id,
                      authorName: linkPendingReply.author,
                    });
                    onScrollToComposer?.();
                    setLinkPendingReply(null);
                  }
                }}
              >
                Got it
              </button>
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
          <p className="muted" style={{ marginTop: 6 }}>It will turn into a stub visible to others. This can't be undone.</p>
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

      {repliesLoading && <div className="muted" style={{ fontSize: 14 }}>Loading replies…</div>}
      <div style={{ display: "grid", gap: 12 }}>
        {replies.map((r) => {
          const isReplyDeleted = r.isDeleted || !!localDeleted[r.id];
          const isReplyEdited = r.isEdited;
          const isReplyOwn = !!profile && r.author === profile.username;

          // Deleted stubs always show
          if (isReplyDeleted) {
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
                border: progressReveal[r.id] ? "4px solid #4b8f6c" : "4px solid var(--dos-border)",
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
                  <textarea
                    className="edit-textarea"
                    value={editReplyBody}
                    onChange={e => setEditReplyBody(e.target.value)}
                    rows={3}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "var(--dos-bg)", color: "var(--dos-fg)",
                      border: "1px solid var(--dos-border)", borderRadius: 4,
                      padding: "8px 10px", fontSize: 14, resize: "vertical",
                      fontFamily: "inherit",
                    }}
                    autoFocus
                  />
                  {editReplyError && (
                    <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 4 }}>{editReplyError}</div>
                  )}
                  {retagWarningReplyId === r.id ? (
                    <div className="retag-warning" style={{ background: "var(--dos-bg)", border: "1px solid var(--dos-border)", borderRadius: 6, padding: "12px 14px", marginTop: 8, fontSize: 13 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Heads up — this reply will be retagged</div>
                      <div style={{ opacity: 0.85, marginBottom: 10 }}>
                        Your progress has moved to{" "}
                        <strong>S{String(progressForShow?.s ?? r.season).padStart(2,"0")} E{String(progressForShow?.e ?? r.episode).padStart(2,"0")}</strong>.
                        {" "}Saving will retag this reply to your current progress — readers below that point who could see it before will no longer see it.
                      </div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="btn" onClick={() => setRetagWarningReplyId(null)} disabled={editReplySubmitting}>Go back</button>
                        <button className="btn primary" onClick={() => handleSaveEditReply(r.id, true)} disabled={editReplySubmitting}>
                          {editReplySubmitting ? "Saving…" : "Save & retag"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
                      <button className="btn" onClick={handleCancelEditReply} disabled={editReplySubmitting}>Cancel</button>
                      <button
                        className="btn primary"
                        onClick={() => handleSaveEditReply(r.id)}
                        disabled={editReplySubmitting || !editReplyBody.trim()}
                      >
                        {editReplySubmitting ? "Saving…" : "Save"}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
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
                />
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
                  <div style={{ position: "relative", display: "inline-block" }}>
                    <button
                      className="btn"
                      style={{ fontSize: 13 }}
                      onClick={() => handleQuote(r)}
                      title="Quote this response"
                    >
                      Quote
                    </button>
                  </div>
                  <button
                    className="btn"
                    style={{ fontSize: 13 }}
                    onClick={() => handleLink(r)}
                    title="Respond"
                  >
                    Respond
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {!repliesLoading && replies.length === 0 && (
          <div className="muted" style={{ fontSize: 14 }}>No responses yet.</div>
        )}
      </div>

      {/* "Respond to the thread" button at the very bottom — only shown when
         at least one reply is actually rendered. Matches the render logic
         above: deleted stubs always show, others are gated by isVisible.
         A friend-room thread with seed replies that don't pass the group or
         progress filter should show no button — the in-entry "Write a
         response" button is the sole entry point in that case. */}
      {replies.some(r => (r.isDeleted || !!localDeleted[r.id]) || isVisible(r).show) && (
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
