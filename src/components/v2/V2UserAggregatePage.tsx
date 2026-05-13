import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  fetchShows,
  fetchProgress,
  fetchPublicProfileByUsername,
  fetchPublicThreadsForUser,
  upsertProgress,
} from "../../lib/db";
import { supabase } from "../../lib/supabaseClient";
import type { Show } from "../../lib/db";
import type { ProgressEntry, Thread } from "../../types";
import V2Layout from "./V2Layout";
import SidebarAvatar from "../SidebarAvatar";
import { navigateToShow } from "./v2nav";
import OneSelectProgress from "../OneSelectProgress";
import { ArrowRight } from "lucide-react";
import EpisodeTag from "../EpisodeTag";
import LoadingDots from "../LoadingDots";
import { canView, timeAgo } from "../../lib/utils";
import { linkifyText } from "../../lib/linkify";

type ClaimSource = "user-progress" | "session" | null;

function progressShort(p: { s: number; e: number }): string {
  if (p.s === 0 && p.e === 0) return "haven't started";
  return `S${String(p.s).padStart(2, "0")} E${String(p.e).padStart(2, "0")}`;
}

function formatRangeDate(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("en-US", { month: "long", day: "numeric" });
}

function relativeShort(ts: number): string {
  // Calls existing timeAgo for the recent end of the range.
  return timeAgo(ts);
}

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
  const [pickerOpen, setPickerOpen] = useState(false);

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
        ]).then(async ([allShows, threads]) => {
          if (cancelled) return;
          const s = allShows.find((x) => x.id === showId);
          setShow(s ?? null);
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

  // Date range for the meta line — first → last (by createdAt).
  const sortedByCreated = useMemo(
    () => [...allOwnerThreads].sort((a, b) => a.createdAt - b.createdAt),
    [allOwnerThreads]
  );
  const firstTs = sortedByCreated[0]?.createdAt;
  const lastTs = sortedByCreated[sortedByCreated.length - 1]?.createdAt;

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
    setPickerOpen(false);
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

  return (
    <V2Layout palette="profile">
      {/* === VIEW BAR === */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 28,
        }}
      >
        <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 14, color: "var(--dos-gray)" }}>
          coming from{" "}
          <a
            href={`/v2/u/${username}`}
            onClick={(e) => { e.preventDefault(); navigate(`/v2/u/${username}`); }}
            style={{ color: "var(--dos-fg)", textDecoration: "none", borderBottom: "1px dotted var(--dos-gray)", paddingBottom: 1, display: "inline-flex", alignItems: "center", gap: 6, verticalAlign: "middle" }}
          >
            <SidebarAvatar userId={ownerId} username={username} size={16} />{username}'s profile
          </a>
        </div>
        <a
          href={`/show/${show.id}`}
          onClick={(e) => { e.preventDefault(); navigateToShow(navigate, show.id); }}
          style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 14, color: "var(--dos-gray)", textDecoration: "none", borderBottom: "1px dotted var(--dos-gray)", paddingBottom: 1, display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          see all public posts on {show.name} <ArrowRight size={13} />
        </a>
      </div>

      {/* === PAGE HEADING === */}
      <header style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 15, color: "var(--dos-gray)", marginBottom: 4 }}>
          <a
            href={`/v2/u/${username}`}
            onClick={(e) => { e.preventDefault(); navigate(`/v2/u/${username}`); }}
            style={{ color: "var(--dos-fg)", textDecoration: "none", borderBottom: "1px dotted var(--dos-gray)", display: "inline-flex", alignItems: "center", gap: 6, verticalAlign: "middle" }}
          >
            <SidebarAvatar userId={ownerId} username={username} size={16} />{username}
          </a>
          's public posts on:
        </div>
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
            marginBottom: 8,
          }}
        >
          {show.name}
        </h1>
        {totalCount > 0 && (
          <p style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 14, color: "var(--dos-gray)" }}>
            <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
              {totalCount} {totalCount === 1 ? "post" : "posts"}
            </strong>
            {firstTs && lastTs && firstTs !== lastTs && (
              <> · written between {formatRangeDate(firstTs)} and {relativeShort(lastTs)}</>
            )}
            {firstTs && lastTs && firstTs === lastTs && (
              <> · written {relativeShort(lastTs)}</>
            )}
          </p>
        )}
      </header>

      {/* === BODY: pre-claim or post-claim === */}
      {!claimed ? (
        <PreClaimCard
          username={username}
          showName={show.name}
          totalCount={totalCount}
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
          show={show}
          onConfirm={handleConfirmProgress}
        />
      ) : (
        <>
          {/* progress status bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 28,
              flexWrap: "wrap",
            }}
          >
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
            >
              ◐ you're at {progressShort(visitorProgress!)}
            </span>
            {!pickerOpen && (
              <button
                onClick={() => setPickerOpen(true)}
                className="btn h40"
                style={{ fontSize: 12 }}
              >
                change progress
              </button>
            )}
            {pickerOpen && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <OneSelectProgress
                  show={show}
                  value={{ s: visitorProgress!.s, e: visitorProgress!.e }}
                  onConfirm={handleConfirmProgress}
                  allowZero={false}
                />
                <button
                  onClick={() => setPickerOpen(false)}
                  className="btn h40"
                  style={{ fontSize: 12 }}
                >
                  cancel
                </button>
              </div>
            )}
          </div>

          {/* visible entries */}
          {visibleThreads.length === 0 && (
            <div
              style={{
                fontFamily: "Lora, Georgia, serif",
                fontStyle: "italic",
                fontSize: 15,
                color: "var(--dos-gray)",
                textAlign: "center",
                padding: "24px 0 32px",
              }}
            >
              none of @{username}'s posts are visible at your progress yet.
            </div>
          )}
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

          {/* you-are-here divider */}
          <div
            style={{
              textAlign: "center",
              margin: "24px 0",
              fontFamily: "Lora, Georgia, serif",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--dos-gray)",
            }}
          >
            ◐ you're here, at {progressShort(visitorProgress!)}
          </div>

          {/* locked summary */}
          {lockedCount > 0 && (
            <div
              style={{
                background: "transparent",
                border: "2px dashed rgba(255,255,255,0.6)",
                borderRadius: 16,
                padding: "20px 28px",
                textAlign: "center",
                fontFamily: "Lora, Georgia, serif",
                fontStyle: "italic",
                fontSize: 15,
                color: "var(--dos-gray)",
                lineHeight: 1.55,
              }}
            >
              <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>
                {lockedCount} more {lockedCount === 1 ? "post" : "posts"}
              </strong>{" "}
              from @{username}, tagged to episodes after where you are. They will appear when you mark more episodes watched.
            </div>
          )}
        </>
      )}
    </V2Layout>
  );
}

// === PRE-CLAIM CARD ===========================================================
//
// Single dashed-border card centered on the page. Clicking the pill reveals
// the standard OneSelectProgress picker; selection + confirm fires
// onConfirm and the parent transitions to the post-claim render.

function PreClaimCard({
  username,
  showName,
  totalCount,
  pickerOpen,
  setPickerOpen,
  show,
  onConfirm,
}: {
  username: string;
  showName: string;
  totalCount: number;
  pickerOpen: boolean;
  setPickerOpen: (b: boolean) => void;
  show: Show;
  onConfirm: (v: { s: number; e: number }) => void;
}) {
  return (
    <article
      style={{
        background: "transparent",
        border: "2px dashed rgba(255,255,255,0.6)",
        borderRadius: 18,
        padding: "32px 36px",
        maxWidth: 580,
        margin: "32px auto",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontFamily: "Lora, Georgia, serif",
          fontSize: 16,
          color: "var(--dos-fg)",
          lineHeight: 1.55,
          marginBottom: 22,
        }}
      >
        <strong style={{ fontWeight: 600 }}>
          @{username} has {totalCount} public {totalCount === 1 ? "post" : "posts"} about {showName}.
        </strong>
        {" "}
        <span style={{ fontStyle: "italic", color: "var(--dos-gray)" }}>
          They're spoiler-gated by where you are in the show. Tell us where you are and {totalCount === 1 ? "the post" : "the posts"} will unfold.
        </span>
      </p>
      {!pickerOpen ? (
        <button
          onClick={() => setPickerOpen(true)}
          className="btn post h40"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          ◐ tell us where you are
        </button>
      ) : (
        <div style={{ display: "inline-flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 8 }}>
          <OneSelectProgress
            show={show}
            value={{ s: 1, e: 1 }}
            onConfirm={onConfirm}
            allowZero={false}
          />
          <button
            onClick={() => setPickerOpen(false)}
            className="btn h40"
            style={{ fontSize: 12 }}
          >
            cancel
          </button>
        </div>
      )}
    </article>
  );
}

// === ENTRY ====================================================================

function Entry({
  thread,
  username,
  ownerId,
  showId,
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
    <article
      className="card"
      style={{
        background: "rgba(255,250,235,0.55)",
        border: "none",
        padding: "24px 28px",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h3
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 22,
              fontWeight: 600,
              color: "var(--dos-fg)",
              lineHeight: 1.25,
              margin: 0,
            }}
          >
            {thread.titleBase}
          </h3>
          <span style={{ fontSize: 13, color: "var(--dos-gray)", fontWeight: 500 }}>
            <EpisodeTag season={thread.season} episode={thread.episode} isRewatch={thread.isRewatch} rewatchS={thread.rewatchS} rewatchE={thread.rewatchE} parens={false} />
          </span>
        </div>
        <span style={{ fontSize: 13, color: "var(--dos-gray)" }}>{timeAgo(thread.updatedAt)}</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--dos-gray)", marginBottom: 14 }}>
        by <strong style={{ color: "var(--dos-fg)", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "middle" }}><SidebarAvatar userId={ownerId} username={username} size={16} />{username}</strong>
      </div>
      <div
        style={{
          fontFamily: "Inter, sans-serif",
          fontSize: 15,
          lineHeight: 1.65,
          color: "var(--dos-fg)",
          whiteSpace: "pre-wrap",
        }}
      >
        {linkifyText(thread.body)}
      </div>
      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,0.35)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <button className="btn post h40" onClick={onOpen} style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
          ✎ write a response
        </button>
        <button className="btn h40" onClick={onOpen} style={{ fontSize: 12 }}>
          quote
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--dos-gray)" }}>
          {replyCount === 0 ? "no responses yet" : `${replyCount} ${replyCount === 1 ? "response" : "responses"}`}
        </span>
      </div>
    </article>
  );
}
