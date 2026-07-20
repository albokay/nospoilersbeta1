/**
 * GroupInviteAcceptPage — accept a people-group invite (restructure CP5a).
 *
 * Reached via /group-invite/:token (the link minted by INVITE FRIENDS). Looks
 * up the invite, shows "Join a group with @X and @Y?", and on Join adds the
 * caller to the people-group (recipient-bound), then routes to /dashboard.
 *
 * Separate from the live friend-room InviteAcceptPage (/invite/:token), which
 * is left untouched. The pre-account landing for brand-new users is CP5b; for
 * now the invitee must already be signed in with the invited email.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { getPeopleGroupInvite, acceptPeopleGroupInvite, declinePeopleGroupInvite, type GroupInviteInfo } from "../lib/db";
import SidebarLogo from "./SidebarLogo";
import AuthModal from "./AuthModal";
import PublicDashboardPage from "./PublicDashboardPage";
import DeckWave from "./deck/DeckWave";
import YoureInCard from "./deck/YoureInCard";
import { CANON } from "../styles/canon";
import { preventLastWordOrphan } from "../lib/utils";

// After an invite sign-up, route the new account to /dashboard (where the
// guided tour auto-fires) instead of the old onboarding. App's post-login
// routing reads + clears this flag; only the invite flow ever sets it, so
// the general sign-up path is untouched.
const POST_SIGNUP_DEST_KEY = "ns_post_signup_dest";

const C = { green: CANON.personal, blue: CANON.identity, yellow: CANON.accent, red: CANON.alert, cream: CANON.cream, midnight: CANON.dark };
const LORA = '"Lora", Georgia, serif';

type Status = "loading" | "ready" | "invalid" | "expired" | "already" | "wrong" | "joining" | "done" | "error";

export default function GroupInviteAcceptPage({ token }: { token: string }) {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<GroupInviteInfo | null>(null);
  const [masked, setMasked] = useState<string | undefined>();
  const [detail, setDetail] = useState<string>("");
  // CP5b: brand-new invitee sign-up. "welcome" → rich landing; "signup" →
  // account creation modal; "entering" → account made, App is routing them in.
  const [phase, setPhase] = useState<"welcome" | "signup" | "entering">("welcome");
  const enteringRef = useRef(false);
  // Existing-account invitee signed in from JOIN IN → show the "Join a group?"
  // confirmation on this page instead of the logged-out welcome screen. (App's
  // generic sign-in → /dashboard redirect is suppressed for /group-invite.)
  const [postSignin, setPostSignin] = useState(false);
  // Onboarding changeset §5: the PRE-WALL wave — wave 1 fires over the
  // logged-out arrival before any account exists (answers park locally and
  // attach on sign-in), opening on the email's quoted card. Completing it
  // reveals the welcome page + JOIN IN (the wall). Self-skips for a visitor
  // who already answered at this door.
  const [prewallDone, setPrewallDone] = useState(false);

  function openAuth() {
    // Brand-new invitee → create-account; flag App to route them to /dashboard
    // after sign-up (where the guided tour fires). Existing-account invitee →
    // sign-in; DON'T set that flag, so they stay here for the join confirm.
    if (!info?.inviteeHasAccount) sessionStorage.setItem(POST_SIGNUP_DEST_KEY, "/dashboard");
    setPhase("signup");
  }
  function onAuthSuccess(mode: "signin" | "signup" | "recovery") {
    if (mode === "signin") {
      setPostSignin(true); // existing account → fall through to the join confirm
    } else {
      enteringRef.current = true;
      setPhase("entering"); // brand-new account → App routes into /dashboard
    }
  }
  function onSignupClose() {
    // Closed without creating an account → drop the routing intent + return.
    if (!enteringRef.current) { sessionStorage.removeItem(POST_SIGNUP_DEST_KEY); setPhase("welcome"); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getPeopleGroupInvite(token);
      if (cancelled) return;
      if (!res.ok) {
        console.error("[group-invite] lookup failed", { token, error: res.error });
        setDetail(`token=${token} · ${res.error}`);
        setStatus(res.error === "expired" ? "expired" : res.error === "already_accepted" ? "already" : "invalid");
        return;
      }
      setInfo(res.info);
      setStatus("ready");
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Safety net: once the invite sign-up account exists, make sure we land on
  // the dashboard even if the global post-login routing didn't fire (both
  // target /dashboard with replace, so a double-navigate is harmless).
  useEffect(() => {
    if (phase === "entering" && user) navigate("/dashboard", { replace: true });
  }, [phase, user, navigate]);

  // Reworked in QA 2026-07-18: the "You're in!" invitee card IS the accept
  // confirmation (replaces the old Yes/no). GET STARTED! accepts → WAVE 1
  // (self-skipping) → straight into the group room. The decline path lost
  // its surface with the Yes/no — flagged.
  async function join() {
    setStatus("joining");
    const res = await acceptPeopleGroupInvite(token);
    if (res.ok) { setStatus("done"); return; }
    if (res.error === "wrong_recipient") { setMasked(res.maskedEmail); setStatus("wrong"); return; }
    if (res.error === "already_accepted") { setStatus("already"); return; }
    if (res.error === "expired") { setStatus("expired"); return; }
    setStatus("error");
  }

  const wants = info?.inviterWants ?? [];
  const watching = info?.inviterWatching ?? [];
  // How the inviter is named to the invitee THROUGHOUT onboarding:
  // inviter_display_name (auto-filled at email time from the inviter's
  // profiles.display_name since CP4 — it becomes the invitee's contact name
  // for them on accept); else the @handle (email leg never ran).
  const inviterLabel = info?.inviterDisplayName || `@${info?.inviterName ?? "someone"}`;
  // "Join a group with …?" — the inviter shows as their typed name; any other
  // already-present members keep their @handle (no typed name to show).
  const others = info ? info.memberNames.filter((n) => n) : [];
  const memberLabels = others.map((n) => (n === info?.inviterName && info?.inviterDisplayName ? info.inviterDisplayName : `@${n}`));
  const names = memberLabels.length
    ? memberLabels.reduce((acc, n, i, arr) => (i === 0 ? n : i === arr.length - 1 ? `${acc} and ${n}` : `${acc}, ${n}`), "")
    : inviterLabel;

  // The signed-in confirm — the "You're in!" card (GET STARTED! = accept).
  if ((status === "ready" || status === "joining") && user && info) {
    return (
      <div style={page}>
        <div style={{ position: "absolute", top: 16, left: 20 }}><SidebarLogo scale={0.5} blocksOpacity={1} /></div>
        <YoureInCard
          idiom="desktop"
          variant={{ kind: "invitee", friendName: info.inviterDisplayName || info.inviterName }}
          busy={status === "joining"}
          onDone={join}
        />
      </div>
    );
  }

  // Joined — wave 1 over the plain green, then straight into the group room.
  if (status === "done") {
    return (
      <div style={page}>
        <div style={{ position: "absolute", top: 16, left: 20 }}><SidebarLogo scale={0.5} blocksOpacity={1} /></div>
        <DeckWave
          wave={1}
          leadCardId="just-wait-ep4"
          heading="welcome"
          idiom="desktop"
          onComplete={() => navigate(info ? `/dashboard?g=${info.groupId}` : "/dashboard", { replace: true })}
        />
      </div>
    );
  }

  // Account just created — brief "setting up" screen while routing to /dashboard.
  if (phase === "entering") {
    return (
      <div style={page}>
        <div style={{ position: "absolute", top: 16, left: 20 }}><SidebarLogo scale={0.5} blocksOpacity={1} /></div>
        <div style={card}><p style={title}>Welcome to Sidebar! Setting up your account…</p></div>
      </div>
    );
  }

  // Logged-out invite arrival — full-page /pool-style view of the inviter's
  // shows + a JOIN IN footer; the auth modal overlays it when JOIN IN is hit.
  // (Skipped once postSignin is set so a just-signed-in existing account falls
  // through to the join confirmation below, even before `user` propagates.)
  if (status === "ready" && info && !user && !authLoading && !postSignin) {
    return (
      <>
        <PublicDashboardPage username={info.inviterName} invite={{ onJoin: openAuth }} displayNameOverride={info.inviterDisplayName || undefined} />
        {!prewallDone && (
          <DeckWave anonymous wave={1} leadCardId="just-wait-ep4" heading="welcome" idiom="desktop" onComplete={() => setPrewallDone(true)} />
        )}
        {phase === "signup" && (
          <AuthModal
            initialMode={info.inviteeHasAccount ? "signin" : "signup"}
            initialEmail={info.inviteeEmail ?? ""}
            lockEmail={!!info.inviteeEmail}
            hint={info.inviteeHasAccount
              ? `Sign in to watch shows with ${inviterLabel} on Sidebar.`
              : `Create your account to watch shows with ${inviterLabel} on Sidebar.`}
            onSuccess={onAuthSuccess}
            onClose={onSignupClose}
            // When "Confirm email" is enabled, a brand-new invitee's confirmation
            // link returns them HERE (signed in) so they land on the join confirm
            // and finish joining the group — not on a bare dashboard.
            signupRedirectTo={typeof window !== "undefined" ? `${window.location.origin}/group-invite/${token}` : undefined}
          />
        )}
      </>
    );
  }

  return (
    <div style={page}>
      <div style={{ position: "absolute", top: 16, left: 20 }}><SidebarLogo scale={0.5} blocksOpacity={1} /></div>
      <div style={card}>
        {status === "loading" && <p style={muted}>Loading…</p>}

        {/* Existing account signed in from JOIN IN; bridge until `user` lands. */}
        {status === "ready" && !user && postSignin && <p style={muted}>Signing you in…</p>}

        {/* (Signed-in ready/joining renders the "You're in!" card above.) */}
        {status === "wrong" && (
          <>
            <p style={title}>{preventLastWordOrphan("This invite was sent to a different email.")}</p>
            <p style={muted}>It's addressed to {masked}. {preventLastWordOrphan("Sign in with that email to join.")}</p>
          </>
        )}
        {status === "already" && (
          <>
            <p style={title}>This invite was already used.</p>
            <button style={ghost} onClick={() => navigate("/dashboard")}>Go to dashboard</button>
          </>
        )}
        {status === "expired" && <p style={title}>This invitation has expired.</p>}
        {status === "invalid" && (
          <>
            <p style={title}>{preventLastWordOrphan("This invitation link isn't valid.")}</p>
            <p style={muted}>{preventLastWordOrphan("This link is no longer active. The invite may have been canceled, or the link is incomplete — ask your friend to send you a new one.")}</p>
          </>
        )}
        {status === "error" && <p style={title}>Something went wrong. Try the link again.</p>}
        {detail && (status === "error" || status === "expired" || status === "already") && (
          <p style={{ ...muted, fontSize: 11, wordBreak: "break-all", opacity: 0.7 }}>{detail}</p>
        )}
      </div>
    </div>
  );
}

const page: React.CSSProperties = {
  position: "fixed", inset: 0, background: C.green, fontFamily: '"Inter", system-ui, sans-serif',
  display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
};
const card: React.CSSProperties = {
  background: C.yellow, borderRadius: 15, padding: "32px 36px", width: "min(420px, 90vw)", textAlign: "center",
};
const title: React.CSSProperties = { fontFamily: LORA, fontWeight: 700, fontSize: 22, letterSpacing: -1, color: CANON.cream, margin: "0 0 8px" };
const muted: React.CSSProperties = { color: C.midnight, fontSize: 13, margin: "8px 0 0" };
const yes: React.CSSProperties = { border: "none", background: C.blue, color: CANON.cream, fontWeight: 700, fontSize: 14, padding: "11px 38px", borderRadius: 65, cursor: "pointer" };
const no: React.CSSProperties = { border: "2px solid var(--canon-cream,#fef8ea)", background: "transparent", color: CANON.cream, fontWeight: 700, fontSize: 14, padding: "10px 30px", borderRadius: 65, cursor: "pointer" };
const ghost: React.CSSProperties = { border: "2px solid var(--canon-cream,#fef8ea)", background: "transparent", color: CANON.cream, fontWeight: 700, fontSize: 14, padding: "10px 28px", borderRadius: 65, cursor: "pointer", marginTop: 14 };
const listBlock: React.CSSProperties = { marginTop: 16, textAlign: "left" };
const listLabel: React.CSSProperties = { color: C.midnight, fontSize: 12, fontWeight: 700, marginBottom: 8 };
const chipRow: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-start" };
const chip: React.CSSProperties = { background: C.cream, color: C.midnight, fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 65 };
