import { CANON } from "../styles/canon";
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Tv } from "lucide-react";
import { useAuth } from "../lib/auth";
import {
  createShow,
  createFriendGroup,
  upsertProgress,
  fetchProgress,
  fetchShows,
  fetchAllFriendGroupsWithActivity,
  markTabCreated,
} from "../lib/db";
import type { Show } from "../lib/db";
import LoadingDots from "../components/LoadingDots";

// S5 — Mobile progress gate. Required step before entering any room (per spec:
// "User cannot proceed without setting their progress").
//
// Two callers:
//
//   /m/rooms/new                   — mode="new". Show is in router state from
//                                    MobileRooms search-result tap. Submission
//                                    creates the show row + friend group +
//                                    user's progress, then enters the new room.
//
//   /m/rooms/:groupId/progress     — mode="existing". Existing friend group;
//                                    show is fetched. Submission upserts
//                                    progress, then enters the room.
//
// The progress picker is a single native <select> grouped by season (works
// well on mobile via the OS picker UI) plus a "haven't started" option when
// (0,0) is allowed. Per HANDOFF §6 item 23, OneSelectProgress's onConfirm
// silently no-ops with requireConfirm={false} — so we don't reuse that
// component here; we just build the select directly to avoid the footgun
// and keep the mobile picker visually consistent with the rest of /m.
//
// Rewatch state is intentionally not exposed in mobile UI for Phase 1 —
// rewatch is desktop complexity (mobile is for active social flow). Users
// already in rewatch mode can still set progress; the underlying DB triggers
// (progress_no_rewatch_rollback, progress_no_rollback_to_zero) protect the
// invariants regardless of which client wrote the value.
type Props =
  | { mode: "new" }
  | { mode: "existing"; groupId: string };

type LoadedShow = { id: string; name: string; seasons: number[]; tvmazeId?: string; networkLabel?: string };

async function tvmazeEpisodesAired(tvmazeId: number): Promise<number[]> {
  // Mirror of SearchShows.tvmazeEpisodes — counts only aired episodes
  // (airstamp <= now) and only "regular" type episodes. Returns an empty
  // array for genuinely unreleased shows so the picker offers only
  // "haven't started" via allowZero.
  const res = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/episodes`);
  if (!res.ok) return [1];
  const episodes: any[] = await res.json();
  const nowIso = new Date().toISOString();
  const bySeason: Record<number, number> = {};
  for (const ep of episodes) {
    const isRegular = ep.type === "regular" || !ep.type;
    const hasAired = typeof ep.airstamp === "string" && ep.airstamp <= nowIso;
    if (isRegular && hasAired) {
      bySeason[ep.season] = (bySeason[ep.season] ?? 0) + 1;
    }
  }
  const seasonKeys = Object.keys(bySeason).map(Number);
  if (!seasonKeys.length) return [];
  const maxSeason = Math.max(...seasonKeys);
  const seasons: number[] = [];
  for (let i = 1; i <= maxSeason; i++) {
    seasons.push(bySeason[i] ?? 0);
  }
  return seasons;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32) || `show${Date.now()}`;
}

const ZERO_ID = "0-0";

export default function MobileProgressGate(props: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [loaded, setLoaded] = useState<LoadedShow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Load the right data depending on mode ──
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    if (props.mode === "new") {
      const sel = (location.state as any)?.selectedShow as
        | { name: string; tvmazeId?: number; networkLabel?: string }
        | undefined;
      if (!sel) {
        setLoadError("missing_selection");
        return;
      }
      const showId = slugify(sel.name);
      const fetchSeasons = sel.tvmazeId
        ? tvmazeEpisodesAired(sel.tvmazeId).catch(() => [1])
        : Promise.resolve([1]);
      fetchSeasons.then(seasons => {
        if (cancelled) return;
        setLoaded({
          id: showId,
          name: sel.name,
          seasons,
          tvmazeId: sel.tvmazeId ? String(sel.tvmazeId) : undefined,
          networkLabel: sel.networkLabel,
        });
        // Default for a brand-new show: "haven't started" (zero progress).
        setPicked({ s: 0, e: 0 });
      });
      return () => { cancelled = true; };
    }

    // existing mode
    if (!user) return;
    const groupId = props.groupId;
    Promise.all([
      fetchAllFriendGroupsWithActivity(user.id),
      fetchShows(),
      fetchProgress(user.id),
    ])
      .then(([rooms, shows, progress]) => {
        if (cancelled) return;
        const room = rooms.find(r => r.id === groupId);
        if (!room) {
          setLoadError("room_not_found");
          return;
        }
        const show = shows.find(s => s.id === room.showId);
        if (!show) {
          setLoadError("show_not_found");
          return;
        }
        setLoaded({
          id: show.id,
          name: show.name,
          seasons: show.seasons || [1],
          tvmazeId: show.tvmazeId ? String(show.tvmazeId) : undefined,
        });
        // Pre-fill with the user's last-known progress for this show, per spec.
        const cur = progress[show.id];
        if (cur) setPicked({ s: cur.s, e: cur.e });
        else setPicked({ s: 0, e: 0 });
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("MobileProgressGate fetch failed:", err);
        setLoadError("fetch_failed");
      });
    return () => { cancelled = true; };
  }, [props.mode, props.mode === "existing" ? props.groupId : null, user?.id]);

  const groups = useMemo(() => {
    if (!loaded) return [];
    const out: { season: number; episodes: { id: string; s: number; e: number }[] }[] = [];
    for (let s = 1; s <= loaded.seasons.length; s++) {
      const eMax = loaded.seasons[s - 1] || 1;
      const episodes = [];
      for (let e = 1; e <= eMax; e++) {
        episodes.push({ id: `${s}-${e}`, s, e });
      }
      out.push({ season: s, episodes });
    }
    return out;
  }, [loaded]);

  // Allow "haven't started" if the show has zero aired episodes (new
  // unreleased shows) OR the user is currently at (0,0). Once they move off
  // zero, the option vanishes for good (defense-in-depth, mirrors
  // OneSelectProgress.tsx:71).
  const allowZero =
    !loaded ? false :
    loaded.seasons.length === 0 || (picked.s === 0 && picked.e === 0);

  const onSelectChange = (id: string) => {
    if (id === ZERO_ID) { setPicked({ s: 0, e: 0 }); return; }
    const [s, e] = id.split("-").map(Number);
    setPicked({ s, e });
  };

  const onSubmit = async () => {
    if (!user || !loaded) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      if (props.mode === "new") {
        const created = await createShow({
          id: loaded.id,
          name: loaded.name,
          seasons: loaded.seasons.length ? loaded.seasons : [1],
          tvmazeId: loaded.tvmazeId,
          status: "Ended",
        });
        const room = await createFriendGroup({
          showId: created.id,
          name: loaded.name,
          createdBy: user.id,
        });
        await upsertProgress(user.id, created.id, picked.s, picked.e);
        markTabCreated(user.id, created.id);
        navigate(`/m/rooms/${room.id}`, { replace: true });
      } else {
        await upsertProgress(user.id, loaded.id, picked.s, picked.e);
        navigate(`/m/rooms/${props.groupId}`, { replace: true });
      }
    } catch (err) {
      console.warn("MobileProgressGate submit failed:", err);
      const msg = err instanceof Error ? err.message : "Could not save progress. Try again.";
      setSubmitError(msg);
      setSubmitting(false);
    }
  };

  // ── Render ──

  const wrapper: React.CSSProperties = {
    minHeight: "100vh",
    background: "var(--dos-bg, var(--canon-personal,#7abd8e))",
    color: CANON.cream,
    padding: "24px 20px 48px",
    boxSizing: "border-box",
  };

  if (loadError === "missing_selection") {
    return (
      <div style={{ ...wrapper, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <p style={{ fontSize: 14, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320 }}>
          No show selected. Search for a show to start a room.
        </p>
        <button
          onClick={() => navigate("/m/rooms", { replace: true })}
          style={pillButtonStyle()}
        >
          ← Back to rooms
        </button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ ...wrapper, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <p style={{ fontSize: 14, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320 }}>
          {loadError === "room_not_found" && "This room doesn't exist or you're not in it."}
          {loadError === "show_not_found" && "Couldn't find the show for this room."}
          {loadError === "fetch_failed" && "Couldn't load room data. Try again."}
        </p>
        <button
          onClick={() => navigate("/m/rooms", { replace: true })}
          style={pillButtonStyle()}
        >
          ← Back to rooms
        </button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ ...wrapper, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 14, opacity: 0.85 }}>Loading<LoadingDots /></span>
      </div>
    );
  }

  const currentSelectionId = picked.s === 0 && picked.e === 0 ? ZERO_ID : `${picked.s}-${picked.e}`;

  return (
    <div style={wrapper}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <button
          onClick={() => navigate(props.mode === "new" ? "/m/rooms" : "/m/rooms")}
          style={{
            background: "transparent", color: CANON.cream,
            border: "none",
            fontSize: 14, fontWeight: 600, cursor: "pointer",
            fontFamily: "inherit", opacity: 0.85,
            padding: "8px 0", marginBottom: 16,
          }}
        >
          ← Back
        </button>

        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px" }}>
          {props.mode === "new" ? "Create a room" : "Confirm your progress"}
        </h1>
        <p style={{ fontSize: 14, opacity: 0.85, margin: "0 0 20px" }}>
          {props.mode === "new"
            ? "A new friend room about:"
            : "Update where you are before entering the room."}
        </p>

        {/* ── Show card ── */}
        <div style={{
          background: "rgba(253,248,236,0.95)",
          color: "var(--dos-bg, #2a4a36)",
          borderRadius: 12,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
        }}>
          <div style={{
            flexShrink: 0,
            width: 40, height: 40,
            borderRadius: 10,
            background: "rgba(0,0,0,0.06)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Tv size={20} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.2 }}>{loaded.name}</div>
            {loaded.networkLabel && (
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{loaded.networkLabel}</div>
            )}
          </div>
        </div>

        {/* ── Progress picker ── */}
        <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8, opacity: 0.9, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Your progress
        </label>
        <select
          className="m-input"
          value={currentSelectionId}
          onChange={e => onSelectChange(e.target.value)}
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: 16,
            fontFamily: "inherit",
            border: "2px solid rgba(253,248,236,0.4)",
            borderRadius: 10,
            background: "rgba(253,248,236,0.08)",
            color: CANON.cream,
            outline: "none",
            boxSizing: "border-box",
            WebkitAppearance: "none",
            appearance: "none",
          }}
        >
          {allowZero && <option value={ZERO_ID}>Haven&rsquo;t started</option>}
          {groups.map(g => (
            <optgroup key={g.season} label={`Season ${g.season}`}>
              {g.episodes.map(ep => (
                <option key={ep.id} value={ep.id}>{`Season ${ep.s} Episode ${ep.e}`}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <p style={{ fontSize: 12, opacity: 0.75, margin: "10px 4px 0", lineHeight: 1.5 }}>
          You&rsquo;ll only see posts up to your selected episode. Nothing ahead of you.
        </p>

        {submitError && (
          <div style={{
            marginTop: 16,
            color: CANON.cream,
            background: "rgba(244,80,40,0.9)",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}>
            {submitError}
          </div>
        )}

        {/* ── Submit ── */}
        <button
          onClick={onSubmit}
          disabled={submitting}
          style={{
            marginTop: 28,
            width: "100%",
            padding: "16px 0",
            fontSize: 18,
            fontWeight: 800,
            fontFamily: "inherit",
            background: CANON.cream,
            color: "var(--dos-bg)",
            border: "none",
            borderRadius: 9999,
            cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.85 : 1,
            letterSpacing: "0.02em",
          }}
        >
          {submitting ? <LoadingDots /> : props.mode === "new" ? "Create room" : "Enter room"}
        </button>
      </div>
    </div>
  );
}

function pillButtonStyle(): React.CSSProperties {
  return {
    background: "transparent", color: CANON.cream,
    border: "2px solid var(--canon-cream,#fef8ea)",
    borderRadius: 9999, padding: "10px 24px",
    fontSize: 14, fontWeight: 700, cursor: "pointer",
    fontFamily: "inherit",
  };
}
