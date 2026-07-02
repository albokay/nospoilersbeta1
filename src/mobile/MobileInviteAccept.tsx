import { CANON } from "../styles/canon";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MonitorPlay, AlertTriangle, Clock, CircleCheck, PartyPopper, Link2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/auth";
import {
  upsertProgress,
  fetchProgress,
  fetchShows,
  markTabCreated,
} from "../lib/db";
import type { Show } from "../lib/db";
import LoadingDots from "../components/LoadingDots";

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
  | "wrong_recipient"
  | "ready"
  | "accepting"
  | "done"
  | "error";

const ZERO_ID = "0-0";

// /m/invite/:token — mobile invite-accept screen.
//
// Receives the token via URL. Mirrors the desktop InviteAcceptPage flow
// exactly (same RPCs, same status states, same recipient binding via
// accept_invitation's wrong_recipient path) — only the UI is rebuilt
// for mobile. The email link itself stays a single static URL — the
// front-end forks at the desktop /invite/:token arm in src/App.tsx, which
// detects mobile viewport and redirects here via <Navigate replace />.
//
// Layout: focused centered page in every state. The invite-accept
// flow no longer wraps <MobileNarrative /> at the top — the homepage
// scroll was getting in the way of the action invitees actually came
// here for (clicking Accept from email). Brand-new invitees who want
// to learn about Sidebar can hit the top-right "Sign in" button on
// MobileNarrative or browse to /m directly; this screen stays focused
// on accept/sign-in/error states.
//
// Auth flow for unauthed invitees: the "Sign in to accept" CTA routes
// to /m/auth?returnTo=/m/invite/:token. MobileAuth honors returnTo on
// success and the user lands back here authed; this component re-fetches
// and shows the "Join" button. No auto-accept after auth — explicit tap
// keeps the user in control of when the invite-bound progress write fires.
export default function MobileInviteAccept({ token }: { token: string }) {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();

  const [status, setStatus] = useState<Status>("loading");
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [errMsg, setErrMsg] = useState("");

  // Progress picker state — only relevant when authed user has no prior
  // progress for this show. Defaults to (0,0) "haven't started".
  const [needsProgressPick, setNeedsProgressPick] = useState(false);
  const [showForInvite, setShowForInvite] = useState<Show | null>(null);
  const [pick, setPick] = useState<{ s: number; e: number }>({ s: 0, e: 0 });

  // Load invite info via the SECURITY DEFINER RPC. Auth not required —
  // the invite link is the entry point for unauthed recipients too.
  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc("get_invitation_by_token", { p_token: token })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) { setStatus("invalid"); return; }
        setInvite(data as InviteInfo);
        setStatus("ready");
      });
    return () => { cancelled = true; };
  }, [token]);

  // Probe whether the authed user already has progress for the invite's
  // show. If not, surface the picker. Mirrors InviteAcceptPage's logic.
  useEffect(() => {
    let cancelled = false;
    if (!user || !invite?.show_id) {
      setNeedsProgressPick(false);
      return;
    }
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
      } catch {
        // Probe failure: degrade gracefully — don't show picker, accept
        // will still run with default (0,0).
      }
    })();
    return () => { cancelled = true; };
  }, [user, invite?.show_id]);

  // Build the season-grouped option set for the picker (same shape as
  // MobileProgressGate — kept inline here since we need just the picker,
  // not the full gate's screen layout).
  const groups = useMemo(() => {
    const seasons = showForInvite?.seasons ?? [];
    const out: { season: number; episodes: { id: string; s: number; e: number }[] }[] = [];
    for (let s = 1; s <= seasons.length; s++) {
      const eMax = seasons[s - 1] || 1;
      const episodes = [];
      for (let e = 1; e <= eMax; e++) {
        episodes.push({ id: `${s}-${e}`, s, e });
      }
      out.push({ season: s, episodes });
    }
    return out;
  }, [showForInvite]);

  const allowZero = !showForInvite || showForInvite.seasons.length === 0 || (pick.s === 0 && pick.e === 0);
  const currentSelectionId = pick.s === 0 && pick.e === 0 ? ZERO_ID : `${pick.s}-${pick.e}`;

  const onSelectChange = (id: string) => {
    if (id === ZERO_ID) { setPick({ s: 0, e: 0 }); return; }
    const [s, e] = id.split("-").map(Number);
    setPick({ s, e });
  };

  const handleAccept = async () => {
    if (!user) {
      navigate(`/m/auth?returnTo=${encodeURIComponent(`/m/invite/${token}`)}`);
      return;
    }
    setStatus("accepting");

    const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });

    if (error || !data?.ok) {
      const code = (data as any)?.error ?? error?.message ?? "unknown";
      if (code === "already_accepted") setStatus("already_accepted");
      else if (code === "expired") setStatus("expired");
      else if (code === "wrong_recipient") {
        setMaskedEmail((data as any)?.invitee_email_masked ?? "");
        setStatus("wrong_recipient");
      } else {
        setErrMsg(code);
        setStatus("error");
      }
      return;
    }

    // Set progress + mark tab if no prior. Same shape as desktop accept.
    if (invite?.show_id && user) {
      try {
        const existing = await fetchProgress(user.id);
        if (!existing[invite.show_id]) {
          await upsertProgress(user.id, invite.show_id, pick.s, pick.e);
          markTabCreated(user.id, invite.show_id);
        }
      } catch {
        // Best-effort: accept succeeded; progress write failure is
        // recoverable from the room's progress gate.
      }
    }

    setStatus("done");
    if (invite?.group_id) {
      // SPA navigate is safe here — mobile doesn't have App-level state
      // racing the way desktop does (see desktop InviteAcceptPage.handleAccept
      // commit a9bbc81 for that history). Replace so back-button doesn't
      // return to the invite page after the join lands.
      setTimeout(() => {
        navigate(`/m/rooms/${invite.group_id}`, { replace: true });
      }, 1200);
    }
  };

  const handleWrongRecipientSignOut = async () => {
    await signOut();
    // After sign-out, route to the auth screen with the same invite
    // returnTo so signing in with the right email lands them back here.
    navigate(`/m/auth?returnTo=${encodeURIComponent(`/m/invite/${token}`)}`);
  };

  // ── Render ──

  const wrapper: React.CSSProperties = {
    minHeight: "100vh",
    background: "var(--dos-bg, var(--canon-personal,#7abd8e))",
    color: CANON.cream,
    padding: "24px 20px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  };

  if (authLoading || status === "loading") {
    return (
      <div style={wrapper}>
        <span style={{ fontSize: 14, opacity: 0.85 }}>Loading<LoadingDots /></span>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <CenteredPage>
        <Link2 size={44} color={CANON.cream} />
        <h1 style={titleStyle}>Invalid invitation</h1>
        <p style={mutedStyle}>
          This invite link doesn&rsquo;t exist, has already been used, or has expired.
        </p>
        <button onClick={() => navigate("/m", { replace: true })} style={primaryBtnStyle()}>
          Go home
        </button>
      </CenteredPage>
    );
  }

  if (status === "expired") {
    return (
      <CenteredPage>
        <Clock size={44} color={CANON.cream} />
        <h1 style={titleStyle}>Invitation expired</h1>
        <p style={mutedStyle}>
          This invite link expired. Ask the room creator to send a new one.
        </p>
        <button onClick={() => navigate("/m", { replace: true })} style={primaryBtnStyle()}>
          Go home
        </button>
      </CenteredPage>
    );
  }

  if (status === "already_accepted") {
    return (
      <CenteredPage>
        <CircleCheck size={44} color={CANON.cream} />
        <h1 style={titleStyle}>Already joined</h1>
        <p style={mutedStyle}>
          This invitation has already been accepted — you may already be in the room.
        </p>
        <button
          onClick={() => navigate(invite?.group_id ? `/m/rooms/${invite.group_id}` : "/m/rooms", { replace: true })}
          style={primaryBtnStyle()}
        >
          Go to room
        </button>
      </CenteredPage>
    );
  }

  if (status === "wrong_recipient") {
    return (
      <CenteredPage>
        <AlertTriangle size={44} color={CANON.cream} />
        <h1 style={titleStyle}>Wrong email</h1>
        <p style={mutedStyle}>
          This invite was sent to{" "}
          {maskedEmail
            ? <strong style={{ color: CANON.cream }}>{maskedEmail}</strong>
            : "a different email"}
          . Sign out and sign in with that address to accept, or ask the inviter to send a new one to the email you&rsquo;re using now.
        </p>
        <button onClick={handleWrongRecipientSignOut} style={primaryBtnStyle()}>
          Sign out
        </button>
      </CenteredPage>
    );
  }

  if (status === "done") {
    return (
      <CenteredPage>
        <PartyPopper size={44} color={CANON.cream} />
        <h1 style={titleStyle}>You&rsquo;re in!</h1>
        <p style={mutedStyle}>
          Joining <strong style={{ color: CANON.cream }}>&ldquo;{invite?.group_name}&rdquo;</strong>… taking you there now.
        </p>
      </CenteredPage>
    );
  }

  if (status === "error") {
    return (
      <CenteredPage>
        <AlertTriangle size={44} color={CANON.cream} />
        <h1 style={titleStyle}>Something went wrong</h1>
        <p style={mutedStyle}>
          {errMsg || "Could not accept the invitation. Please try again."}
        </p>
        <button onClick={() => navigate("/m", { replace: true })} style={primaryBtnStyle()}>
          Go home
        </button>
      </CenteredPage>
    );
  }

  // ── "ready" state ──
  //
  // Two layouts, branched on auth state:
  //   - Signed out: narrative scroll up top, accept flow at the bottom
  //     (per spec: invitees see "a version of the homepage narrative
  //     scroll, with an accept invite button at the bottom").
  //   - Signed in: bare centered "You're invited!" screen — they already
  //     have a Sidebar account, the pitch is redundant. Per #5 in the
  //     2026-04-25 polish spec.
  //
  // The inviteContent fragment is shared between both layouts; only the
  // outer wrapper differs.
  const inviteContent = (
    <>
      <MonitorPlay size={44} color={CANON.cream} />
      <h1 style={titleStyle}>You&rsquo;re invited!</h1>
      <p style={{ ...mutedStyle, lineHeight: 1.5 }}>
        Join the private watch room{" "}
        <strong style={{ color: CANON.cream }}>&ldquo;{invite?.group_name}&rdquo;</strong>
      </p>

      {!user ? (
        <>
          <p style={{ ...mutedStyle, fontSize: 13, opacity: 0.7, marginBottom: 4 }}>
            Sign in or create a free account to join.
          </p>
          <button
            onClick={() =>
              navigate(`/m/auth?returnTo=${encodeURIComponent(`/m/invite/${token}`)}`)
            }
            style={primaryBtnStyle()}
          >
            Sign in to accept
          </button>
        </>
      ) : (
        <>
          {needsProgressPick && showForInvite && (
            <div style={{ width: "100%", maxWidth: 360, marginBottom: 8, textAlign: "left" }}>
              <label style={{
                display: "block",
                fontSize: 12, fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                opacity: 0.85,
                marginBottom: 6,
                textAlign: "center",
              }}>
                Where are you in the show?
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
            </div>
          )}
          <button
            onClick={handleAccept}
            disabled={status === "accepting"}
            style={primaryBtnStyle(status !== "accepting")}
          >
            {status === "accepting" ? <LoadingDots /> : `Join "${invite?.group_name}"`}
          </button>
        </>
      )}

      {invite && (
        <p style={{ fontSize: 11, opacity: 0.55, marginTop: 12 }}>
          Expires {new Date(invite.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </p>
      )}
    </>
  );

  // Both signed-in and signed-out invitees see a focused centered
  // page with the invite controls. The earlier signed-out variant
  // wrapped <MobileNarrative hideBottom /> at the top to give brand-
  // new invitees the homepage pitch first; that wrapper was dropped
  // per polish feedback — invitees clicking through from email want
  // the accept flow up front, not the homepage scroll. The narrative
  // is still reachable via the top-right "Sign in" button if a fresh
  // invitee wants to learn what Sidebar is before signing in.
  return <CenteredPage>{inviteContent}</CenteredPage>;
}

// ── Layout helpers (mobile-tuned versions of desktop Page/Emoji) ──

function CenteredPage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--dos-bg, var(--canon-personal,#7abd8e))",
      color: CANON.cream,
      padding: "32px 24px",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      gap: 12,
    }}>
      {children}
    </div>
  );
}

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  margin: "8px 0 4px",
  lineHeight: 1.2,
};

const mutedStyle: React.CSSProperties = {
  fontSize: 14,
  opacity: 0.85,
  margin: 0,
  maxWidth: 360,
  lineHeight: 1.5,
};

function primaryBtnStyle(enabled: boolean = true): React.CSSProperties {
  return {
    background: enabled ? CANON.cream : "rgba(253,248,236,0.4)",
    color: "var(--dos-bg)",
    border: "none",
    borderRadius: 9999,
    padding: "12px 28px",
    fontSize: 15,
    fontWeight: 800,
    cursor: enabled ? "pointer" : "default",
    fontFamily: "inherit",
    marginTop: 12,
    minWidth: 180,
  };
}
