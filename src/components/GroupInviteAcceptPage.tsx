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
import { getPeopleGroupInvite, acceptPeopleGroupInvite, declinePeopleGroupInvite, fetchInviteLetter, type GroupInviteInfo, type InviteLetter } from "../lib/db";
import { setInviteeWelcome } from "../lib/inviteeWelcome";
import SidebarLogo from "./SidebarLogo";
import { markJoinedThisSession } from "../lib/joinSession";
import { claimInvitePicks } from "../lib/invitePicks";
import AuthModal from "./AuthModal";
import PublicDashboardPage from "./PublicDashboardPage";
import DeckWave from "./deck/DeckWave";
import YoureInCard from "./deck/YoureInCard";
import HomepageNarrative from "./HomepageNarrative";
import { readPendingDeckAnswers } from "../lib/deckPending";
import { CANON } from "../styles/canon";
import { preventLastWordOrphan } from "../lib/utils";
import { useEditorial } from "../lib/skin";
import { E } from "../styles/editorial";
import LoadingDots from "./LoadingDots";
import { InviteWall, InviteStatePage } from "./editorial/Invite";

// After an invite sign-up, route the new account to /dashboard (where the
// guided tour auto-fires) instead of the old onboarding. App's post-login
// routing reads + clears this flag; only the invite flow ever sets it, so
// the general sign-up path is untouched.
const POST_SIGNUP_DEST_KEY = "ns_post_signup_dest";

const C = { green: CANON.personal, blue: CANON.identity, yellow: CANON.accent, red: CANON.alert, cream: CANON.cream, midnight: CANON.dark };
const LORA = '"Lora", Georgia, serif';

type Status = "loading" | "ready" | "invalid" | "expired" | "already" | "wrong" | "joining" | "done" | "error";

export default function GroupInviteAcceptPage({ token }: { token: string }) {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  // The editorial skin (checkpoint 7, 2026-10-12): the wall, the account
  // form, the You're in card and the wave draw themselves under the skin;
  // the other states become a page on cream.
  const editorial = useEditorial();
  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<GroupInviteInfo | null>(null);
  // The inviter's first letter (the invitee-flow pass, 2026-10-17): read
  // with the invite, so every step can lead with it; null keeps the old copy.
  const [letter, setLetter] = useState<InviteLetter | null>(null);
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
  // The invite-arrival PROLOGUE (Alborz 2026-08-19): the homepage scroll's
  // invitee variant, shown BEFORE the door questions to a brand-new invitee.
  // One unit with the door: a visitor who already answered at this door
  // (≥4 parked answers — the same store the wave self-skips from) skips the
  // scroll too; existing-account invitees skip both via inviteeHasAccount.
  const [prologueDone, setPrologueDone] = useState<boolean>(() => {
    try { return Object.keys(readPendingDeckAnswers()).length >= 4; } catch { return false; }
  });

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
      const [res, lt] = await Promise.all([getPeopleGroupInvite(token), fetchInviteLetter(token)]);
      if (cancelled) return;
      setLetter(lt);
      if (!res.ok) {
        // Don't log/paint the raw token (security pass 2026-08-14) — it lands
        // in support screenshots + any future console-capturing tool. The
        // error code is enough to diagnose; the token is already in the URL.
        console.error("[group-invite] lookup failed", res.error);
        setDetail(res.error ?? "");
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
    if (res.ok) {
      // Suggested-shows picks from the wall become proposals in the group —
      // fire-and-forget while wave 1 plays, so they exist by room load.
      if (user && info) claimInvitePicks(user.id, info.groupId, token).catch(() => {});
      // The first-visit tips speak to an invitee whose friend left a letter.
      if (user && info && letter) setInviteeWelcome(user.id, { groupId: info.groupId, inviter: info.inviterDisplayName || info.inviterName, showId: letter.showId, showName: letter.showName });
      setStatus("done");
      return;
    }
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
          variant={{ kind: "invitee", friendName: info.inviterDisplayName || info.inviterName, showName: letter?.showName, opensAt: letter?.sealed ? { s: letter.s, e: letter.e } : undefined }}
          busy={status === "joining"}
          onDone={join}
        />
      </div>
    );
  }

  // Joined — wave 1 over the plain green, then the dashboard (his note,
  // 10-14: the invitee lands where the standard onboarding lands; the group's
  // cluster waits there, with their pitched picks already in it).
  if (status === "done") {
    return (
      <div style={page}>
        <div style={{ position: "absolute", top: 16, left: 20 }}><SidebarLogo scale={0.5} blocksOpacity={1} /></div>
        <DeckWave
          wave={1}
          leadCardId="just-wait-ep4"
          heading="welcome"
          idiom="desktop"
          onComplete={() => {
            // Standing issue (b): hold wave 2 for their NEXT session — the
            // first visit is these 4 questions + the room itself.
            markJoinedThisSession();
            navigate("/dashboard", { replace: true });
          }}
        />
      </div>
    );
  }

  // Account just created — brief "setting up" screen while routing to /dashboard.
  if (phase === "entering") {
    if (editorial) return <InviteStatePage desktop title="Welcome to Sidebar! Setting up your account…" />;
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
    // The PROLOGUE (Alborz 2026-08-19): a brand-new invitee's first sight is
    // the homepage scroll's invitee variant; "Join {name} →" hands off to
    // the door questions. Normal document flow — the scroll IS the page.
    if (!prologueDone && !info.inviteeHasAccount) {
      return (
        <div style={{ minHeight: "100svh", ...(editorial ? { background: "var(--canon-personal,#7abd8e)" } : {}) }}>
          <HomepageNarrative
            headerHeight={0}
            editorial={editorial}
            invitee={{
              inviterName: info.inviterDisplayName || info.inviterName || "Your friend",
              showName: letter?.showName,
              onJoin: () => { window.scrollTo(0, 0); setPrologueDone(true); },
            }}
          />
        </div>
      );
    }
    return (
      <>
        {/* QA round 6: while the pre-wall wave is up, the background is
            blank green (+ the wave's tint) — the pool behind collided with
            the wave's heading. The pool reveals when the wave completes. */}
        {/* The door questions are for STRANGERS. An invitee whose email
            already has an account (inviteeHasAccount from the invite lookup)
            skips them and lands on the wall directly (Alborz 2026-08-18) —
            they'd only be re-answering, and the post-join wave self-skips
            for them anyway. */}
        {(prewallDone || info.inviteeHasAccount) ? (
          editorial
            ? <InviteWall desktop token={token} info={info} inviterName={inviterLabel} onJoin={openAuth} letter={letter} />
            : <PublicDashboardPage username={info.inviterName} invite={{ onJoin: openAuth, token }} displayNameOverride={info.inviterDisplayName || undefined} />
        ) : editorial ? (
          // The welcome questions' own yellow ground (his catch, 10-14): the
          // invite page drawn here flashed cream with the wordmark before the
          // questions painted.
          <div aria-hidden="true" style={{ position: "fixed", inset: 0, background: E.color.accent }} />
        ) : (
          <div style={page}>
            <div style={{ position: "absolute", top: 16, left: 20 }}><SidebarLogo scale={0.5} blocksOpacity={1} /></div>
          </div>
        )}
        {!prewallDone && !info.inviteeHasAccount && (
          <DeckWave anonymous wave={1} leadCardId="just-wait-ep4" heading="welcome" idiom="desktop" inviterName={inviterLabel} onComplete={() => setPrewallDone(true)} />
        )}
        {phase === "signup" && (
          <AuthModal
            initialMode={info.inviteeHasAccount ? "signin" : "signup"}
            initialEmail={info.inviteeEmail ?? ""}
            lockEmail={!!info.inviteeEmail}
            hint={info.inviteeHasAccount
              ? `Sign in to watch shows with ${inviterLabel} on Sidebar.`
              : letter
                ? letter.sealed
                  ? `Create your account to watch shows with ${inviterLabel}.`
                  : `Create your account to watch shows with ${inviterLabel} (and read the first letter that’s waiting for you).`
                : `Create your account to watch shows with ${inviterLabel} on Sidebar.`}
            onSuccess={onAuthSuccess}
            onClose={onSignupClose}
            // When "Confirm email" is enabled, a brand-new invitee's confirmation
            // link returns them HERE (signed in) so they land on the join confirm
            // and finish joining the group — not on a bare dashboard.
            signupRedirectTo={typeof window !== "undefined" ? `${window.location.origin}/group-invite/${token}` : undefined}
            // The confirmation email names the friend whose letter waits.
            signupLetterFrom={letter ? (info.inviterDisplayName || info.inviterName) : undefined}
          />
        )}
      </>
    );
  }

  if (editorial) {
    const tail = detail && (status === "error" || status === "expired" || status === "already") ? ` (${detail})` : "";
    if (status === "loading") return <InviteStatePage desktop title={<>loading<LoadingDots /></>} />;
    if (status === "ready" && !user && postSignin) return <InviteStatePage desktop title="Signing you in…" />;
    if (status === "wrong") return <InviteStatePage desktop title="This invite was sent to a different email." note={<>It&rsquo;s addressed to {masked}. Sign in with that email, then try again with your email invite link.</>} action={{ label: "Sign out", onClick: async () => { await signOut(); window.location.reload(); } }} />;
    if (status === "already") return <InviteStatePage desktop title="This invite was already used." note={tail || undefined} action={{ label: "Go to dashboard", onClick: () => navigate("/dashboard") }} />;
    if (status === "expired") return <InviteStatePage desktop title="This invitation has expired." note={tail || undefined} />;
    if (status === "invalid") return <InviteStatePage desktop title="This invitation link isn't valid." note="This link is no longer active. The invite may have been canceled, or the link is incomplete — ask your friend to send you a new one." />;
    return <InviteStatePage desktop title="Something went wrong. Try the link again." note={tail || undefined} />;
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
            <p style={muted}>It's addressed to {masked}. {preventLastWordOrphan("Sign in with that email, then try again with your email invite link.")}</p>
            {/* Sign out (Alborz 2026-09-28): clears this session and reloads
                the same invite link, so they land on it logged out and can
                sign in with the invited email. A full reload, not an SPA
                hop — the old /invite page's sign-out found SPA navigation
                out of an invite page left a blank green. */}
            <button style={ghost} onClick={async () => { await signOut(); window.location.reload(); }}>Sign out</button>
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
