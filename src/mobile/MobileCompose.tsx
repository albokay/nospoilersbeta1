import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  insertThread,
  addThreadToGroup,
  fetchAllFriendGroupsWithActivity,
  fetchShows,
  fetchProgress,
} from "../lib/db";
import type { Show } from "../lib/db";
import type { FriendGroup, ProgressEntry } from "../types";
import { effectiveProgress } from "../lib/utils";
import LoadingDots from "../components/LoadingDots";

// /m/rooms/:groupId/compose — new entry composer (friend-room scoped).
//
// Writes a private thread (is_public: false) and links it to the room via
// addThreadToGroup. Tags season/episode using effectiveProgress so the
// rewatcher rule holds: a rewatcher's post is tagged at their highest
// (spoiler ceiling), not their rewatch position. The raw rewatch position
// is preserved in rewatch_season/rewatch_episode for display purposes.
//
// No room-name or destination dropdown — mobile compose is always
// "post to this room" (the room context is in the URL). Desktop's
// three-destination dropdown (private/group/public) doesn't apply: mobile
// is rooms-only.
export default function MobileCompose({ groupId }: { groupId: string }) {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [room, setRoom] = useState<FriendGroup | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [progress, setProgress] = useState<ProgressEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      fetchAllFriendGroupsWithActivity(user.id),
      fetchShows(),
      fetchProgress(user.id),
    ])
      .then(([rooms, shows, progressMap]) => {
        if (cancelled) return;
        const r = rooms.find(x => x.id === groupId);
        if (!r) { setLoadError("not_member"); return; }
        const s = shows.find(x => x.id === r.showId);
        if (!s) { setLoadError("show_not_found"); return; }
        setRoom(r);
        setShow(s);
        setProgress(progressMap[r.showId] ?? null);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("MobileCompose fetch failed:", err);
        setLoadError("fetch_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [groupId, user?.id]);

  const eff = effectiveProgress(progress);
  const tag = eff
    ? `S${String(eff.s).padStart(2, "0")} E${String(eff.e).padStart(2, "0")}`
    : null;

  const canSubmit =
    !!user && !!show && !!eff &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    !submitting;

  const onSubmit = async () => {
    if (!user || !show || !eff || !profile?.username) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const trimmedTitle = title.trim();
      const trimmedBody = body.trim();
      const preview = trimmedBody.slice(0, 240) + (trimmedBody.length > 240 ? "…" : "");

      // Rewatch metadata: if the author is rewatching, the post is tagged
      // at their highest (eff.s/eff.e above) and the rewatch position is
      // preserved in rewatch_season/rewatch_episode for display ("written
      // on Sarah's rewatch of S2E3"). Same shape the desktop composer uses.
      const isRewatch = !!progress?.isRewatching;
      const rewatchSeason = isRewatch ? progress?.s : undefined;
      const rewatchEpisode = isRewatch ? progress?.e : undefined;

      const thread = await insertThread({
        showId: show.id,
        season: eff.s,
        episode: eff.e,
        authorId: user.id,
        authorName: profile.username,
        title: trimmedTitle,
        preview,
        body: trimmedBody,
        isPublic: false,
        isRewatch,
        rewatchSeason,
        rewatchEpisode,
      });
      await addThreadToGroup(thread.id, groupId);

      // Land on the new thread directly. Replace so back-button returns
      // to the room view, not back to the now-empty compose form.
      navigate(`/m/rooms/${groupId}/thread/${thread.id}`, { replace: true });
    } catch (err) {
      console.warn("MobileCompose submit failed:", err);
      const msg = err instanceof Error ? err.message : "Could not post. Try again.";
      setSubmitError(msg);
      setSubmitting(false);
    }
  };

  // ── Render ──

  const wrapper: React.CSSProperties = {
    minHeight: "100vh",
    background: "var(--dos-bg, #7abd8e)",
    color: "#FEF8EA",
    padding: "16px 20px 32px",
    boxSizing: "border-box",
  };

  if (loading) {
    return (
      <div style={{ ...wrapper, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 14, opacity: 0.85 }}>Loading<LoadingDots /></span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ ...wrapper, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <p style={{ fontSize: 14, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320 }}>
          {loadError === "not_member" && "You're not in this room."}
          {loadError === "show_not_found" && "Couldn't find the show for this room."}
          {loadError === "fetch_failed" && "Couldn't load the room. Try again."}
        </p>
        <button
          onClick={() => navigate(`/m/rooms/${groupId}`, { replace: true })}
          style={{
            background: "transparent", color: "#FEF8EA",
            border: "2px solid #FEF8EA",
            borderRadius: 9999, padding: "10px 24px",
            fontSize: 14, fontWeight: 700, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ← Back
        </button>
      </div>
    );
  }

  if (!eff) {
    return (
      <div style={{ ...wrapper, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <p style={{ fontSize: 14, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>
          Set your watch progress before posting. Posts get tagged at your current episode so spoiler-filtering can work.
        </p>
        <button
          onClick={() => navigate(`/m/rooms/${groupId}/progress`)}
          style={{
            background: "#FEF8EA", color: "var(--dos-bg)",
            border: "none",
            borderRadius: 9999, padding: "12px 28px",
            fontSize: 15, fontWeight: 800, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Set progress
        </button>
      </div>
    );
  }

  return (
    <div style={wrapper}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        {/* ── Top bar (Cancel only — Post moved below the body) ── */}
        <div style={{
          display: "flex",
          justifyContent: "flex-start",
          alignItems: "center",
          marginBottom: 12,
        }}>
          <button
            onClick={() => navigate(`/m/rooms/${groupId}`)}
            disabled={submitting}
            style={{
              background: "transparent", color: "#FEF8EA",
              border: "none",
              fontSize: 15, fontWeight: 600, cursor: submitting ? "default" : "pointer",
              fontFamily: "inherit", opacity: submitting ? 0.55 : 0.85,
              padding: "6px 0",
            }}
          >
            Cancel
          </button>
        </div>

        {/* ── Context line ── */}
        <div style={{
          fontSize: 12,
          opacity: 0.85,
          margin: "0 0 16px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}>
          <span style={{ fontWeight: 700 }}>{room?.name}</span>
          <span style={{ opacity: 0.6 }}>·</span>
          <span>{show?.name}</span>
          <span style={{ opacity: 0.6 }}>·</span>
          <span style={{
            fontVariantNumeric: "tabular-nums",
            background: "rgba(253,248,236,0.18)",
            padding: "2px 8px",
            borderRadius: 999,
            fontWeight: 700,
          }}>
            tag {tag}
          </span>
        </div>

        {progress?.isRewatching && (
          <p style={{
            fontSize: 12,
            opacity: 0.8,
            margin: "0 0 12px",
            lineHeight: 1.45,
            background: "rgba(253,248,236,0.10)",
            padding: "8px 12px",
            borderRadius: 8,
          }}>
            Tagged at your highest progress because you&rsquo;re rewatching. Visible to viewers who&rsquo;ve watched at least {tag}.
          </p>
        )}

        {/* ── Title input ── */}
        <input
          className="m-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title"
          maxLength={200}
          autoFocus
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: 18,
            fontWeight: 700,
            fontFamily: "inherit",
            border: "2px solid rgba(253,248,236,0.4)",
            borderRadius: 10,
            background: "rgba(253,248,236,0.08)",
            color: "#FEF8EA",
            outline: "none",
            boxSizing: "border-box",
            WebkitAppearance: "none",
            marginBottom: 10,
          }}
        />

        {/* ── Body textarea ── */}
        <textarea
          className="m-input"
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="What did you think about this episode?"
          maxLength={10000}
          rows={12}
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: 16,
            fontFamily: "inherit",
            lineHeight: 1.5,
            border: "2px solid rgba(253,248,236,0.4)",
            borderRadius: 10,
            background: "rgba(253,248,236,0.08)",
            color: "#FEF8EA",
            outline: "none",
            boxSizing: "border-box",
            WebkitAppearance: "none",
            resize: "vertical",
            minHeight: 240,
          }}
        />

        {submitError && (
          <div style={{
            marginTop: 12,
            color: "#FEF8EA",
            background: "rgba(244,80,40,0.9)",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}>
            {submitError}
          </div>
        )}

        {/* ── Submit (moved from header to under the body field) ── */}
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            marginTop: 16,
            width: "100%",
            padding: "16px 0",
            fontSize: 18,
            fontWeight: 800,
            fontFamily: "inherit",
            background: canSubmit ? "#FEF8EA" : "rgba(253,248,236,0.4)",
            color: "var(--dos-bg)",
            border: "none",
            borderRadius: 9999,
            cursor: canSubmit ? "pointer" : "default",
            letterSpacing: "0.02em",
          }}
        >
          {submitting ? <LoadingDots /> : "Post"}
        </button>
      </div>
    </div>
  );
}
