import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  fetchShows,
  fetchProgress,
  fetchPublicProfileByUsername,
  fetchPublicProgressForUser,
  fetchPublicThreadsForUser,
  upsertProgress,
  canRespondToPublicRoom,
  insertPendingPublicResponse,
  notifyPublicResponseRequest,
  fetchMyPendingResponseThreadIds,
} from "../../lib/db";
import { supabase } from "../../lib/supabaseClient";
import type { Show } from "../../lib/db";
import type { ProgressEntry, Thread } from "../../types";
import V2Layout from "./V2Layout";
import TreatedArt from "../TreatedArt";
import OneSelectProgress from "../OneSelectProgress";
import { Clock, SquarePen } from "lucide-react";
import LoadingDots from "../LoadingDots";
import AuthModal from "../AuthModal";
import V2RoomFeed, { type V2RoomFeedEntry, type PublicRoomResponseGate } from "./V2RoomFeed";
import { useComposeModal } from "./ComposeModal";
import { canView } from "../../lib/utils";

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
  const location = useLocation();
  const { user, profile, loading: authLoading } = useAuth();
  const composeModal = useComposeModal();

  // Captured once on mount. After publishing a public post the author lands
  // here (public-rooms scope, 2026); ComposeModal / V2ComposePage pass the
  // new thread id via location.state so we can auto-expand it in the feed.
  const [publishedThreadId] = useState<string | null>(
    () => (location.state as { publishedThreadId?: string } | null)?.publishedThreadId ?? null,
  );

  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [show, setShow] = useState<Show | null>(null);
  const [allOwnerThreads, setAllOwnerThreads] = useState<Thread[]>([]);
  // Per-reply metadata for the owner's public threads (group_id IS NULL).
  // Drives reply counts AND the new-response notification dots — green (new
  // visible responses since last visit, any viewer) and red (new responses
  // hidden from the owner by progress gating, owner only).
  const [replyMeta, setReplyMeta] = useState<
    { threadId: string; createdAt: number; season: number; episode: number; authorId: string }[]
  >([]);
  const [visitorProgress, setVisitorProgress] = useState<ProgressEntry | null>(null);
  const [claimSource, setClaimSource] = useState<ClaimSource>(null);
  // Owner's progress on THIS show. Shown in the heading as "They've watched
  // Season X Episode Y" so the visitor can calibrate against the owner.
  const [ownerProgress, setOwnerProgress] = useState<ProgressEntry | null>(null);
  // Local sign-in / sign-up modal — opened when a logged-out visitor clicks
  // any interact button (Write a response, Like, Quote) on an expanded
  // thread card. V2 pages mount outside AppShell so they don't share the
  // AppShell-level AuthModal.
  const [showAuthModal, setShowAuthModal] = useState(false);

  // ── Public-room response gate (public-rooms scope, 2026) ──────────────
  // canRespondDirect: null while resolving; true = owner / friend / approved
  // (normal composer); false = the viewer must request permission (the
  // composer switches to request-to-respond and holds the response for the
  // owner). Logged-out viewers never reach the composer — every interact
  // button routes through the auth modal — so the gate is only built when
  // signed in.
  const [canRespondDirect, setCanRespondDirect] = useState<boolean | null>(null);
  const [pendingThreadIds, setPendingThreadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !ownerId) { setCanRespondDirect(null); setPendingThreadIds(new Set()); return; }
    if (ownerId === user.id) { setCanRespondDirect(true); setPendingThreadIds(new Set()); return; }
    let cancelled = false;
    Promise.all([
      canRespondToPublicRoom(ownerId, user.id),
      fetchMyPendingResponseThreadIds(ownerId, user.id),
    ]).then(([can, pend]) => {
      if (cancelled) return;
      setCanRespondDirect(can);
      setPendingThreadIds(pend);
    });
    return () => { cancelled = true; };
  }, [user, ownerId]);

  const handleSubmitRequest = useCallback<PublicRoomResponseGate["onSubmitRequest"]>(
    async (threadId, payload) => {
      if (!user || !profile || !ownerId) return;
      const pendingId = await insertPendingPublicResponse({
        threadId,
        showId,
        ownerId,
        requesterId: user.id,
        requesterName: profile.username,
        body: payload.body,
        message: payload.message || null,
        season: payload.season,
        episode: payload.episode,
        referenceType: payload.reference?.type ?? null,
        referencedReplyId: payload.reference?.replyId ?? null,
        referencedThreadId: payload.reference?.threadId ?? null,
        quotedText: payload.reference?.type === "quote" ? payload.reference.quotedText ?? null : null,
      });
      // Email the owner (best-effort — the held response is already saved).
      notifyPublicResponseRequest(pendingId).catch(() => {});
      setPendingThreadIds((prev) => new Set([...prev, threadId]));
    },
    [user, profile, ownerId, showId],
  );

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
          setReplyMeta([]);
          // Fetch public replies (meta) for these threads. group_id IS NULL
          // restricts to public-conversation replies (friend-room replies
          // share the threads table but live in a different space). We read
          // created_at + season/episode + author so the client can compute
          // counts AND the green/red notification dots.
          if (onShow.length) {
            const ids = onShow.map((t) => t.id);
            try {
              const { data } = await supabase
                .from("replies")
                .select("thread_id, created_at, season, episode, author_id")
                .in("thread_id", ids)
                .eq("is_deleted", false)
                .is("group_id", null);
              if (cancelled) return;
              setReplyMeta((data ?? []).map((r: any) => ({
                threadId: r.thread_id as string,
                createdAt: new Date(r.created_at).getTime(),
                season: r.season as number,
                episode: r.episode as number,
                authorId: r.author_id as string,
              })));
            } catch {
              // Dots + counts are nice-to-have; degrade silently if RLS or
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

  // ── New-response notification dots (public-rooms scope) ─────────────────
  // All public replies feed the entry card's Mail count.
  const replyCounts = useMemo<Record<string, number>>(() => {
    const c: Record<string, number> = {};
    for (const r of replyMeta) c[r.threadId] = (c[r.threadId] ?? 0) + 1;
    return c;
  }, [replyMeta]);

  // Last-visit timestamp for THIS public room (per browser). Captured once
  // when the owner id resolves; the same effect stamps "now" so the next
  // visit compares against this one.
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);
  useEffect(() => {
    if (!ownerId) { setLastSeenAt(null); return; }
    const key = `ns_pubroom_seen_${ownerId}_${showId}`;
    setLastSeenAt(Number(localStorage.getItem(key) ?? 0));
    localStorage.setItem(key, String(Date.now()));
  }, [ownerId, showId]);

  // Green dismisses when the viewer opens the entry (within the session).
  const [greenDismissed, setGreenDismissed] = useState<Set<string>>(new Set());
  // Bumped on an X-dismiss so the red memo re-reads localStorage.
  const [redDismissTick, setRedDismissTick] = useState(0);

  // Green = new VISIBLE responses since last visit, for any signed-in viewer
  // (measured against their own progress; never their own replies). Rendered
  // as V2RoomFeed's canon-green circle behind the entry's expand chevron.
  const cellSignals = useMemo<Record<string, { kind: "green" }>>(() => {
    if (!user || !visitorProgress || lastSeenAt == null) return {};
    const out: Record<string, { kind: "green" }> = {};
    for (const r of replyMeta) {
      if (r.authorId === user.id || greenDismissed.has(r.threadId)) continue;
      if (r.createdAt > lastSeenAt && canView({ season: r.season, episode: r.episode }, visitorProgress)) {
        out[r.threadId] = { kind: "green" };
      }
    }
    return out;
  }, [replyMeta, user, visitorProgress, lastSeenAt, greenDismissed]);

  // Red = responses HIDDEN from the owner by progress gating (owner only).
  // Carries a count + an X-dismiss that snoozes through the latest hidden
  // reply, re-firing if a newer hidden response lands. There's no map here,
  // so the dot rides the entry card.
  const entryRedDots = useMemo<Record<string, { count: number; onDismiss: () => void }>>(() => {
    void redDismissTick; // re-read localStorage after a dismiss
    const ownerViewing = !!user && !!ownerId && ownerId === user.id;
    if (!ownerViewing || !visitorProgress) return {};
    const acc: Record<string, { count: number; latest: number }> = {};
    for (const r of replyMeta) {
      if (r.authorId === user!.id) continue;
      if (!canView({ season: r.season, episode: r.episode }, visitorProgress)) {
        const cur = acc[r.threadId] ?? { count: 0, latest: 0 };
        cur.count += 1;
        cur.latest = Math.max(cur.latest, r.createdAt);
        acc[r.threadId] = cur;
      }
    }
    const out: Record<string, { count: number; onDismiss: () => void }> = {};
    for (const [tid, info] of Object.entries(acc)) {
      const dismissedAt = Number(localStorage.getItem(`ns_pubroom_reddismiss_${tid}`) ?? 0);
      if (info.latest > dismissedAt) {
        out[tid] = {
          count: info.count,
          onDismiss: () => {
            localStorage.setItem(`ns_pubroom_reddismiss_${tid}`, String(info.latest));
            setRedDismissTick((n) => n + 1);
          },
        };
      }
    }
    return out;
  }, [replyMeta, user, ownerId, visitorProgress, redDismissTick]);

  // V2 inline-expand entries for this per-user-per-show feed. All threads
  // here are by `username`; authorId resolves to the page-level ownerId.
  const feedEntries = useMemo<V2RoomFeedEntry[]>(() => {
    return visibleThreads.map((t) => ({
      threadId: t.id,
      s: t.season,
      e: t.episode,
      title: t.titleBase,
      body: t.body,
      preview: t.preview,
      authorId: ownerId ?? "",
      authorUsername: username,
      isRewatch: t.isRewatch,
      rewatchS: t.rewatchS,
      rewatchE: t.rewatchE,
      isEdited: t.isEdited,
      isDeleted: t.isDeleted ?? false,
      updatedAt: t.updatedAt,
      replyCount: replyCounts[t.id] ?? 0,
      thread: t,
    }));
  }, [visibleThreads, ownerId, username, replyCounts]);

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

  // Owner viewing their own public room. Drives the owner-aware chrome:
  // "your public writing on:" eyebrow + a write button that opens the
  // standard compose modal (the only way to add originals to a public room).
  const isOwner = !!user && !!ownerId && ownerId === user.id;

  // Built only when signed in and the gate has resolved. Passing it switches
  // the response composer into request-to-respond mode for non-friends.
  const publicRoomGate: PublicRoomResponseGate | undefined =
    user && canRespondDirect !== null
      ? {
          ownerUsername: username,
          canRespondDirect,
          pendingThreadIds,
          onSubmitRequest: handleSubmitRequest,
        }
      : undefined;

  return (
    <V2Layout palette="profile">
      {/* === EYEBROW ===
          Inter (default), small, lowercase — matches the general public
          space's "public writing about:" eyebrow style (ShowSection.tsx:
          1896). The @username link keeps a dashed underline; the rest of
          the line is plain text. */}
      <div style={{ fontSize: 13, fontWeight: 400, lineHeight: 1.2, color: "var(--dos-light)", marginBottom: 4 }}>
        {isOwner ? (
          <>your public writing on:</>
        ) : (
          <>
            <a
              href={`/u/${username}`}
              onClick={(e) => { e.preventDefault(); navigate(`/u/${username}`); }}
              style={{ color: "var(--dos-fg)", textDecoration: "none", borderBottom: "1px dashed var(--dos-gray)" }}
            >
              @{username}
            </a>
            's public posts on:
          </>
        )}
      </div>

      {/* === H1 ROW ===
          SHOW NAME. The old "all public posts on SHOW →" button (which linked
          to the show-wide public aggregate) was removed in the public-rooms
          scope (2026). The owner's "write" button lives in the nav row below,
          in the same position the write button takes elsewhere on the site. */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
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
        {isOwner ? (
          // Owner: the "write" button takes the left of the nav row (the
          // visitor calibration sentence is for visitors only — showing the
          // owner "@you has watched… how far along are you?" reads wrong).
          <button
            className="btn post"
            onClick={() => composeModal.open({ showId, returnTo: location.pathname })}
            style={{ flexShrink: 0, lineHeight: 1.2, display: "inline-flex", alignItems: "center", gap: 5 }}
            title="Start a new public post"
          >
            <SquarePen size={15} /> write
          </button>
        ) : (
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
        )}
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
          {feedEntries.length > 0 && (
            <V2RoomFeed
              entries={feedEntries}
              sortOrder="desc"
              viewerProgress={visitorProgress}
              userId={user?.id ?? null}
              onAuthRequired={() => setShowAuthModal(true)}
              onClickProfile={(name) => navigate(`/u/${encodeURIComponent(name)}`)}
              initialExpandedThreadId={publishedThreadId ?? undefined}
              publicRoomGate={publicRoomGate}
              cellSignals={cellSignals}
              entryRedDots={entryRedDots}
              onEntryExpanded={(tid) => setGreenDismissed((prev) => new Set([...prev, tid]))}
            />
          )}

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

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          hint="Sign in or create an account to write, reply, like, or quote."
        />
      )}
    </V2Layout>
  );
}

