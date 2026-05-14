import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  fetchShows,
  fetchProgress,
  fetchPublicProfileByUsername,
  fetchPublicProgressForUser,
  fetchPublicThreadsForUser,
  upsertProgress,
} from "../../lib/db";
import { supabase } from "../../lib/supabaseClient";
import type { Show } from "../../lib/db";
import type { ProgressEntry, Thread } from "../../types";
import V2Layout from "./V2Layout";
import SidebarAvatar from "../SidebarAvatar";
import TreatedArt from "../TreatedArt";
import { navigateToShow } from "./v2nav";
import OneSelectProgress from "../OneSelectProgress";
import { ArrowRight, Clock, Mail } from "lucide-react";
import EpisodeTag from "../EpisodeTag";
import LoadingDots from "../LoadingDots";
import LikeBadge from "../LikeBadge";
import { canView, timeAgo } from "../../lib/utils";

type ClaimSource = "user-progress" | "session" | null;


// Session-storage browse progress — same key family used by the live
// SearchShows browse-public flow (see SearchShows.tsx:255).
function readBrowseProgress(showId: string): ProgressEntry | null {
  try {
    const raw = sessionStorage.getItem(`ns_browse_prog_${showId}`);
    return raw ? (JSON.parse(raw) as ProgressEntry) : null;
  } catch {
    return null;
  }
}
function writeBrowseProgress(showId: string, entry: ProgressEntry) {
  try {
    sessionStorage.setItem(`ns_browse_prog_${showId}`, JSON.stringify(entry));
  } catch {}
}

export default function V2UserAggregatePage({ username, showId }: { username: string; showId: string }) {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [show, setShow] = useState<Show | null>(null);
  const [allOwnerThreads, setAllOwnerThreads] = useState<Thread[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [visitorProgress, setVisitorProgress] = useState<ProgressEntry | null>(null);
  const [claimSource, setClaimSource] = useState<ClaimSource>(null);
  // Owner's progress on THIS show. Shown in the heading as "They've watched
  // Season X Episode Y" so the visitor can calibrate against the owner.
  const [ownerProgress, setOwnerProgress] = useState<ProgressEntry | null>(null);

  // Bootstrap — works for logged-out visitors too.
  useEffect(() => {
    let cancelled = false;
    setNotFound(false);
    setOwnerId(null);
    fetchPublicProfileByUsername(username)
      .then((p) => {
        if (cancelled) return;
        if (!p) { setNotFound(true); return; }
        setOwnerId(p.id);
        return Promise.all([
          fetchShows(),
          fetchPublicThreadsForUser(p.id),
          fetchPublicProgressForUser(p.id),
        ]).then(async ([allShows, threads, ownerProg]) => {
          if (cancelled) return;
          const s = allShows.find((x) => x.id === showId);
          setShow(s ?? null);
          setOwnerProgress(ownerProg[showId] ?? null);
          // Filter to this show only.
          const onShow = threads.filter((t) => t.showId === showId);
          setAllOwnerThreads(onShow);
          // Fetch public-reply counts for these threads. group_id IS NULL
          // restricts to public-conversation replies (friend-room replies
          // share the threads table but live in a different space).
          if (onShow.length) {
            const ids = onShow.map((t) => t.id);
            try {
              const { data } = await supabase
                .from("replies")
                .select("thread_id")
                .in("thread_id", ids)
                .eq("is_deleted", false)
                .is("group_id", null);
              if (cancelled) return;
              const counts: Record<string, number> = {};
              for (const r of data ?? []) {
                const tid = (r as any).thread_id as string;
                counts[tid] = (counts[tid] ?? 0) + 1;
              }
              setReplyCounts(counts);
            } catch {
              // Counts are nice-to-have; degrade silently if RLS or
              // network blocks them.
            }
          }
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2UserAggregatePage owner load failed:", err);
      });
    return () => { cancelled = true; };
  }, [username, showId]);

  // Visitor's progress on this show. Logged-in users with a real progress
  // row use that; otherwise we fall through to session storage (covers
  // both logged-out visitors and logged-in users without a journal tab on
  // this show).
  useEffect(() => {
    let cancelled = false;
    if (user) {
      fetchProgress(user.id)
        .then((m) => {
          if (cancelled) return;
          const p = m[showId];
          if (p) {
            setVisitorProgress(p);
            setClaimSource("user-progress");
            return;
          }
          // No real progress — fall through to session.
          const sess = readBrowseProgress(showId);
          if (sess) {
            setVisitorProgress(sess);
            setClaimSource("session");
          } else {
            setVisitorProgress(null);
            setClaimSource(null);
          }
        })
        .catch(() => {
          // Fall back to session storage on any RLS/network failure.
          const sess = readBrowseProgress(showId);
          if (sess) {
            setVisitorProgress(sess);
            setClaimSource("session");
          }
        });
    } else {
      const sess = readBrowseProgress(showId);
      if (sess) {
        setVisitorProgress(sess);
        setClaimSource("session");
      } else {
        setVisitorProgress(null);
        setClaimSource(null);
      }
    }
    return () => { cancelled = true; };
  }, [user?.id, showId]);

  const visibleThreads = useMemo(() => {
    if (!visitorProgress) return [];
    return allOwnerThreads.filter((t) =>
      canView({ season: t.season, episode: t.episode }, visitorProgress)
    );
  }, [allOwnerThreads, visitorProgress]);

  const lockedCount = allOwnerThreads.length - visibleThreads.length;

  async function handleConfirmProgress(v: { s: number; e: number }) {
    if (!show) return;
    const entry: ProgressEntry = { s: v.s, e: v.e };
    if (user) {
      // Logged-in users with a real progress row → write to it (same
      // path the standard progress-update flow uses). Users without one
      // fall back to session-only browse progress so we don't auto-create
      // a journal tab for them just from a visitor-side claim.
      if (claimSource === "user-progress") {
        try {
          await upsertProgress(user.id, show.id, v.s, v.e);
        } catch (err) {
          console.warn("upsertProgress failed:", err);
        }
      } else {
        writeBrowseProgress(show.id, entry);
      }
    } else {
      writeBrowseProgress(show.id, entry);
    }
    setVisitorProgress((prev) => ({ ...prev, ...entry }));
    if (claimSource !== "user-progress") setClaimSource("session");
  }

  // === GUARDS ===
  if (notFound) {
    return (
      <V2Layout palette="profile">
        <div style={{ textAlign: "center", marginTop: 60 }}>
          <h1 style={{ fontFamily: "Lora, Georgia, serif", fontSize: 32, color: "var(--dos-fg)" }}>profile not found</h1>
          <p style={{ marginTop: 16, color: "var(--dos-gray)", fontStyle: "italic", fontFamily: "Lora, Georgia, serif" }}>
            no Sidebar profile for <strong>@{username}</strong>.
          </p>
        </div>
      </V2Layout>
    );
  }
  if (!ownerId || !show) {
    return (
      <V2Layout palette="profile">
        <div style={{ textAlign: "center", marginTop: 60, color: "var(--dos-gray)", fontStyle: "italic" }}>
          loading<LoadingDots />
        </div>
      </V2Layout>
    );
  }

  const claimed = !!visitorProgress;
  const totalCount = allOwnerThreads.length;

  // Owner progress sentence — only renders when we actually have a
  // non-zero progress row for the owner on this show. If the owner has
  // posts but no public progress row (edge case), we skip the sentence
  // rather than printing "Season 00 Episode 00".
  const hasOwnerProgress = !!ownerProgress && !(ownerProgress.s === 0 && ownerProgress.e === 0);

  return (
    <V2Layout palette="profile">
      {/* === EYEBROW ===
          Inter (default), small, lowercase — matches the general public
          space's "public writing about:" eyebrow style (ShowSection.tsx:
          1896). The @username link keeps a dashed underline; the rest of
          the line is plain text. */}
      <div style={{ fontSize: 13, fontWeight: 400, lineHeight: 1.2, color: "var(--dos-light)", marginBottom: 4 }}>
        <a
          href={`/v2/u/${username}`}
          onClick={(e) => { e.preventDefault(); navigate(`/v2/u/${username}`); }}
          style={{ color: "var(--dos-fg)", textDecoration: "none", borderBottom: "1px dashed var(--dos-gray)" }}
        >
          @{username}
        </a>
        's public posts on:
      </div>

      {/* === H1 ROW ===
          SHOW NAME on the left, "all public posts on SHOW →" button on
          the right (mirrors the friend-room "to public conversation"
          button placement, ShowSection.tsx:1867). Flex-wrap allows the
          button to drop to a new line on narrow viewports. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <h1
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 700,
            fontSize: 44,
            letterSpacing: "0.02em",
            color: "var(--dos-fg)",
            textTransform: "uppercase",
            lineHeight: 1.05,
            margin: 0,
            flex: "0 1 auto",
            minWidth: 0,
            overflowWrap: "break-word",
          }}
        >
          {show.name}
        </h1>
        <button
          className="btn"
          onClick={() => navigateToShow(navigate, show.id)}
          style={{
            whiteSpace: "nowrap",
            fontSize: 13,
            flexShrink: 0,
            padding: "3px 12px",
            background: "transparent",
            border: "2px solid #fff",
            color: "#fff",
          }}
        >
          all public posts on {show.name} <ArrowRight size={14} color="var(--icon-color)" style={{ verticalAlign: "middle" }} />
        </button>
      </div>

      {/* === NAV ROW ===
          Profile explanation on the left, progress dropdown on the
          right (mirrors the general public space's nav row layout where
          the "you've watched: SE" pill sits at the far right). The
          explanation flexes to fill remaining space and wraps freely. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 28,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: "var(--dos-light)",
            lineHeight: 1.5,
            flex: "1 1 200px",
            minWidth: 0,
          }}
        >
          {totalCount > 0 ? (
            <>
              <strong style={{ fontWeight: 600 }}>@{username}</strong>
              {hasOwnerProgress && (
                <> has watched Season {String(ownerProgress!.s).padStart(2, "0")} Episode {String(ownerProgress!.e).padStart(2, "0")} and</>
              )}
              {" "}has written {totalCount} {totalCount === 1 ? "entry" : "entries"}. How far along are you?
            </>
          ) : null}
        </p>
        <div style={{ flexShrink: 0 }}>
          <OneSelectProgress
            show={show}
            value={visitorProgress ? { s: visitorProgress.s, e: visitorProgress.e } : { s: 0, e: 0 }}
            onConfirm={handleConfirmProgress}
            allowZero={true}
          />
        </div>
      </div>

      {/* === BODY ===
          Three terminal states:
          1. totalCount === 0 → pioneer empty state (owner has no posts).
          2. claimed && visibleThreads.length > 0 → thread cards.
          3. claimed && visibleThreads.length === 0 && lockedCount > 0 →
             dashed-box "X more posts… after where you are".
          Unclaimed (no confirmed visitor progress) → nothing under the
          nav row. */}
      {totalCount === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "120px 0 48px", gap: 12 }}>
          <Clock size={24} color="var(--icon-color)" />
          <div className="muted" style={{ fontSize: 14, textAlign: "center", maxWidth: 360, lineHeight: 1.5 }}>
            <p style={{ margin: 0 }}>@{username} doesn't have anything for you to read yet. It's only a matter of time&hellip;</p>
            <p style={{ margin: "12px 0 0" }}>But this is your chance to be a pioneer. When you post publicly on your profile, your writing will be visible to others.</p>
          </div>
        </div>
      ) : claimed ? (
        <>
          {visibleThreads.map((t) => (
            <Entry
              key={t.id}
              thread={t}
              username={username}
              ownerId={ownerId}
              showId={show.id}
              replyCount={replyCounts[t.id] ?? 0}
              onOpen={() => navigateToShow(navigate, show.id, { threadId: t.id })}
            />
          ))}

          {lockedCount > 0 && (
            <div
              style={{
                background: "transparent",
                border: "2px dashed rgba(255,255,255,0.6)",
                borderRadius: 16,
                padding: "20px 28px",
                marginTop: visibleThreads.length > 0 ? 24 : 0,
                textAlign: "center",
                fontFamily: "Inter, sans-serif",
                fontSize: 15,
                color: "var(--dos-gray)",
                lineHeight: 1.55,
              }}
            >
              <strong style={{ fontWeight: 600, color: "var(--dos-fg)" }}>
                {lockedCount} more {lockedCount === 1 ? "post" : "posts"}
              </strong>{" "}
              from @{username}, tagged to episodes after where you are. They will appear when you mark more episodes watched.
            </div>
          )}
        </>
      ) : null}

      {/* Treated art — driven by the page's fixed showId (the show
          being aggregated). No random pick; the show IS the page
          context. */}
      <TreatedArt showId={showId} anchor="fixed" />
    </V2Layout>
  );
}

// === ENTRY ====================================================================
//
// Thread card matching the general public space's card (ShowSection.tsx:2808
// area). Whole card is clickable — opens the thread in the general public
// space via navigateToShow with the threadId; respond / star / etc happen
// inside the opened thread, not on the card. Star here is read-only (visual
// parity only); the actual star action lives inside the thread view.

function Entry({
  thread,
  username,
  ownerId,
  replyCount,
  onOpen,
}: {
  thread: Thread;
  username: string;
  ownerId: string | null;
  showId: string;
  replyCount: number;
  onOpen: () => void;
}) {
  return (
    <div style={{ position: "relative", margin: "0 0 12px 0" }}>
      <div
        className="card threadCard"
        style={{
          margin: 0,
          cursor: "pointer",
          position: "relative",
          paddingTop: 12,
          paddingBottom: 36,
          border: "4px solid var(--dos-border)",
        }}
        onClick={onOpen}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 22 }} className="title">
            {thread.titleBase}
            <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 7, whiteSpace: "nowrap" }}>
              <EpisodeTag
                season={thread.season}
                episode={thread.episode}
                isRewatch={thread.isRewatch}
                rewatchS={thread.rewatchS}
                rewatchE={thread.rewatchE}
              />
            </span>
            {thread.isEdited && (
              <span style={{ fontStyle: "italic", fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 6 }}>(edited)</span>
            )}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LikeBadge count={0} readOnly title="open post to vote" />
          </div>
        </div>

        <div className="muted" style={{ marginTop: 4, fontSize: 14, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          Started by{" "}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "middle", fontWeight: 700 }}>
            <SidebarAvatar userId={ownerId} username={username} size={16} />
            {username}
          </span>
          {" "}• {timeAgo(thread.updatedAt)}
        </div>

        <div style={{ marginTop: 6 }}>
          <div className="clamp3">{thread.preview}</div>
        </div>

        <div className="replyCount" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>
            <Mail size={14} color="var(--icon-color)" style={{ verticalAlign: "middle" }} /> {replyCount}
          </span>
        </div>
      </div>
    </div>
  );
}
