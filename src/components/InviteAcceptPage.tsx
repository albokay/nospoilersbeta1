import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link2, Clock, CircleCheck, PartyPopper, AlertTriangle, Clapperboard } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/auth";
import { upsertProgress, fetchProgress, fetchShows, markTabCreated } from "../lib/db";
import type { Show } from "../lib/db";
import AuthModal from "./AuthModal";
import OneSelectProgress from "./OneSelectProgress";

type InviteInfo = {
  id: string;
  group_id: string;
  group_name: string;
  show_id: string | null;
  expires_at: string;
};

type Status =
  | "loading"
  | "invalid"
  | "expired"
  | "already_accepted"
  | "ready"
  | "accepting"
  | "done"
  | "error";

export default function InviteAcceptPage({ token }: { token: string }) {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus]   = useState<Status>("loading");
  const [invite, setInvite]   = useState<InviteInfo | null>(null);
  const [errMsg, setErrMsg]   = useState("");
  const [showAuth, setShowAuth] = useState(false);
  // Zero-progress: when the joiner has no prior progress for this show,
  // they pick it here (including "haven't started"). If they already
  // have progress for the show, this is skipped entirely.
  const [needsProgressPick, setNeedsProgressPick] = useState(false);
  const [progressPick, setProgressPick] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [showForInvite, setShowForInvite] = useState<Show | null>(null);
  // Tracks the user/show pair the progress check has completed for. Auto-accept
  // gates on this matching the current pair so it can't fire before the picker
  // decision has actually been resolved. A plain boolean wouldn't work — Effect
  // B reads from the current render's closure, so a setState reset inside
  // Effect A would not propagate in time. Using a key makes the gate
  // self-resetting whenever user or show changes.
  const [progressCheckedFor, setProgressCheckedFor] = useState<string | null>(null);
  const currentCheckKey = user && invite?.show_id ? `${user.id}::${invite.show_id}` : null;

  // Load invite info (no auth needed — SECURITY DEFINER RPC)
  useEffect(() => {
    supabase
      .rpc("get_invitation_by_token", { p_token: token })
      .then(({ data, error }) => {
        if (error || !data) { setStatus("invalid"); return; }
        setInvite(data as InviteInfo);
        setStatus("ready");
      });
  }, [token]);

  async function handleAccept() {
    if (!user) { setShowAuth(true); return; }
    setStatus("accepting");

    const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });

    if (error || !data?.ok) {
      const code = (data as any)?.error ?? error?.message ?? "unknown";
      if      (code === "already_accepted") setStatus("already_accepted");
      else if (code === "expired")          setStatus("expired");
      else { setErrMsg(code); setStatus("error"); }
      return;
    }

    // Ensure the user has a progress entry for this show (creates the profile tab).
    // If the joiner picked their progress in this page (because they had none),
    // use that value — including zero. Otherwise inherit whatever they already have.
    if (invite?.show_id && user) {
      try {
        const existing = await fetchProgress(user.id);
        if (!existing[invite.show_id]) {
          await upsertProgress(user.id, invite.show_id, progressPick.s, progressPick.e);
          // Accepting an invite into a show the user hasn't got a progress row
          // for creates a new tab — float it to the front like a journal create.
          markTabCreated(user.id, invite.show_id);
        }
      } catch {}
    }

    setStatus("done");
    // Navigate to the user's journal. Hard reload (not SPA navigate) so
    // App remounts and re-runs fetchProgress — otherwise App's progress
    // state is stale (empty for a brand-new signup whose fetchProgress
    // already ran before handleAccept wrote the row), ProfilePage's
    // showTabOrder is empty, and the user lands on a blank screen until
    // they refresh. No `state.activeTab` directive is needed: markTabCreated
    // above floats the just-accepted show to position 0 in showTabOrder,
    // which ProfilePage's default-pick selects.
    const showId = invite?.show_id;
    const groupId = invite?.group_id;
    if (showId && groupId) {
      sessionStorage.setItem(`ns_active_group_${showId}`, groupId);
    }
    setTimeout(() => {
      window.location.assign("/profile");
    }, 1800);
  }

  // Decide whether the joiner needs to pick their progress. Only when
  // they have no prior progress row for this show — otherwise their
  // existing progress is inherited untouched.
  useEffect(() => {
    let cancelled = false;
    if (!user || !invite?.show_id) {
      setNeedsProgressPick(false);
      setProgressCheckedFor(null);
      return;
    }
    const key = `${user.id}::${invite.show_id}`;
    (async () => {
      try {
        const [existing, allShows] = await Promise.all([
          fetchProgress(user.id),
          fetchShows(),
        ]);
        if (cancelled) return;
        const hasPrior = !!existing[invite.show_id!];
        setNeedsProgressPick(!hasPrior);
        const sh = allShows.find(x => x.id === invite.show_id) || null;
        setShowForInvite(sh);
        setProgressCheckedFor(key);
      } catch {
        // If this probe fails, fall back to not showing the picker; accept
        // will still run with the default progressPick (zero). The failure
        // would be transient network — the UX degrades gracefully. Mark
        // the check as done either way so auto-accept isn't deadlocked.
        if (cancelled) return;
        setProgressCheckedFor(key);
      }
    })();
    return () => { cancelled = true; };
  }, [user, invite?.show_id]);

  // If the user just signed in / signed up via the auth modal, auto-accept.
  // Two gates: (1) no progress pick needed, and (2) the progress check has
  // actually completed for the CURRENT user/show pair. The second gate
  // prevents the race where this effect runs in the same render as the
  // fetch effect (after sign-in) and reads the stale default
  // needsProgressPick=false before fetchProgress has resolved.
  useEffect(() => {
    if (user && status === "ready" && showAuth && !needsProgressPick && progressCheckedFor === currentCheckKey) {
      setShowAuth(false);
      handleAccept();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, needsProgressPick, progressCheckedFor, currentCheckKey]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (authLoading || status === "loading") {
    return (
      <Page>
        <p className="muted" style={{ fontSize: 14 }}>Loading…</p>
      </Page>
    );
  }

  if (status === "invalid") {
    return (
      <Page>
        <Emoji><Link2 size={44} color="var(--icon-color)" /></Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>Invalid invitation</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          This invite link doesn't exist, has already been used, or has expired.
        </p>
        <button className="btn" onClick={() => navigate("/")}>Go home</button>
      </Page>
    );
  }

  if (status === "expired") {
    return (
      <Page>
        <Emoji><Clock size={44} color="var(--icon-color)" /></Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>Invitation expired</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          This invite link expired. Ask the room creator to send a new one.
        </p>
        <button className="btn" onClick={() => navigate("/")}>Go home</button>
      </Page>
    );
  }

  if (status === "already_accepted") {
    return (
      <Page>
        <Emoji><CircleCheck size={44} color="var(--icon-color)" /></Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>Already joined</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          This invitation has already been accepted — you may already be in the room.
        </p>
        <button
          className="btn"
          onClick={() => navigate(invite?.show_id ? `/show/${invite.show_id}` : "/")}
        >
          Go to show
        </button>
      </Page>
    );
  }

  if (status === "done") {
    return (
      <Page>
        <Emoji><PartyPopper size={44} color="var(--icon-color)" /></Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>You're in!</h2>
        <p className="muted">
          Joining <strong style={{ color: "var(--fg)" }}>"{invite?.group_name}"</strong>…
          taking you there now.
        </p>
      </Page>
    );
  }

  if (status === "error") {
    return (
      <Page>
        <Emoji><AlertTriangle size={44} color="var(--icon-color)" /></Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>Something went wrong</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          {errMsg || "Could not accept the invitation. Please try again."}
        </p>
        <button className="btn" onClick={() => navigate("/")}>Go home</button>
      </Page>
    );
  }

  // ── "ready" state ──────────────────────────────────────────────────────────
  return (
    <>
      <Page>
        <Emoji><Clapperboard size={44} color="var(--icon-color)" /></Emoji>
        <h2 className="title" style={{ marginBottom: 6 }}>You're invited!</h2>
        <p style={{ fontSize: 15, color: "rgba(255,255,255,0.65)", marginBottom: 28, lineHeight: 1.5 }}>
          Join the private watch room{" "}
          <strong style={{ color: "var(--fg)" }}>"{invite?.group_name}"</strong>
        </p>

        {!user ? (
          <>
            <p style={{ fontSize: 13, opacity: 0.5, marginBottom: 16 }}>
              Sign in or create a free account to join.
            </p>
            <button
              className="btn"
              onClick={() => setShowAuth(true)}
              style={{ background: "var(--green)", border: "none", color: "#fff", padding: "10px 28px", fontSize: 15 }}
            >
              Sign in to accept
            </button>
          </>
        ) : (
          <>
            {needsProgressPick && showForInvite && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 8 }}>Where are you in the show?</div>
                <div style={{ display: "inline-block" }}>
                  <OneSelectProgress
                    show={showForInvite}
                    value={progressPick}
                    onConfirm={(val) => setProgressPick(val)}
                    requireConfirm={false}
                    allowZero
                    showChevron
                  />
                </div>
              </div>
            )}
            <button
              className="btn"
              onClick={handleAccept}
              disabled={status === "accepting" || (needsProgressPick && !showForInvite)}
              style={{ background: "#fff", border: "none", color: "#7abd8e", padding: "10px 28px", fontSize: 15, fontWeight: 700 }}
            >
              {(status as string) === "accepting" ? "Joining…" : `Join "${invite?.group_name}"`}
            </button>
          </>
        )}

        {invite && (
          <p style={{ fontSize: 11, opacity: 0.35, marginTop: 20 }}>
            Expires {new Date(invite.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </p>
        )}
      </Page>

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          hint={`Sign in to join "${invite?.group_name}" on No Spoilers`}
        />
      )}
    </>
  );
}

// ── Layout helpers ─────────────────────────────────────────────────────────────

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      padding: "0 24px",
      gap: 6,
    }}>
      {children}
    </div>
  );
}

function Emoji({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 44, marginBottom: 4, lineHeight: 1 }}>{children}</div>;
}
