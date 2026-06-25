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
import { getPeopleGroupInvite, acceptPeopleGroupInvite, type GroupInviteInfo } from "../lib/db";
import SidebarLogo from "./SidebarLogo";
import AuthModal from "./AuthModal";
import PublicDashboardPage from "./PublicDashboardPage";

// After an invite sign-up, route the new account to /dashboard (where the
// guided tour auto-fires) instead of the old onboarding. App's post-login
// routing reads + clears this flag; only the invite flow ever sets it, so
// the general sign-up path is untouched.
const POST_SIGNUP_DEST_KEY = "ns_post_signup_dest";

const C = { green: "#7ABD8E", blue: "#355EB8", yellow: "#DEA838", red: "#F45028", cream: "#FEF8EA", midnight: "#1A3A4A" };
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

  function startSignup() {
    sessionStorage.setItem(POST_SIGNUP_DEST_KEY, "/dashboard");
    setPhase("signup");
  }
  function onSignupSuccess() {
    enteringRef.current = true;
    setPhase("entering");
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

  async function join() {
    setStatus("joining");
    const res = await acceptPeopleGroupInvite(token);
    if (res.ok) { setStatus("done"); setTimeout(() => navigate("/dashboard", { replace: true }), 900); return; }
    if (res.error === "wrong_recipient") { setMasked(res.maskedEmail); setStatus("wrong"); return; }
    if (res.error === "already_accepted") { setStatus("already"); return; }
    if (res.error === "expired") { setStatus("expired"); return; }
    setStatus("error");
  }

  const wants = info?.inviterWants ?? [];
  const watching = info?.inviterWatching ?? [];
  const others = info ? info.memberNames.filter((n) => n) : [];
  const names = others.length
    ? others.map((n) => `@${n}`).reduce((acc, n, i, arr) => (i === 0 ? n : i === arr.length - 1 ? `${acc} and ${n}` : `${acc}, ${n}`), "")
    : `@${info?.inviterName ?? "someone"}`;

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
  // shows + a JOIN IN footer; the sign-up modal overlays it when JOIN IN is hit.
  if (status === "ready" && info && !user && !authLoading) {
    return (
      <>
        <PublicDashboardPage username={info.inviterName} invite={{ onJoin: startSignup }} />
        {phase === "signup" && (
          <AuthModal
            initialMode="signup"
            initialEmail={info.inviteeEmail ?? ""}
            lockEmail={!!info.inviteeEmail}
            hint={`Create your account to watch shows with @${info.inviterName} on Sidebar.`}
            onSuccess={onSignupSuccess}
            onClose={onSignupClose}
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

        {status === "ready" && user && (
          <>
            <p style={title}>Join a group with {names}?</p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
              <button style={yes} onClick={join}>Yes</button>
              <button style={no} onClick={() => navigate("/dashboard")}>no</button>
            </div>
          </>
        )}

        {status === "joining" && <p style={muted}>Joining…</p>}
        {status === "done" && <p style={title}>You're in! Taking you to your dashboard…</p>}
        {status === "wrong" && (
          <>
            <p style={title}>This invite was sent to a different email.</p>
            <p style={muted}>It's addressed to {masked}. Sign in with that email to join.</p>
          </>
        )}
        {status === "already" && (
          <>
            <p style={title}>This invite was already used.</p>
            <button style={ghost} onClick={() => navigate("/dashboard")}>Go to dashboard</button>
          </>
        )}
        {status === "expired" && <p style={title}>This invitation has expired.</p>}
        {status === "invalid" && <p style={title}>This invitation link isn't valid.</p>}
        {status === "error" && <p style={title}>Something went wrong. Try the link again.</p>}
        {detail && (status === "invalid" || status === "error" || status === "expired" || status === "already") && (
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
const title: React.CSSProperties = { fontFamily: LORA, fontWeight: 700, fontSize: 22, letterSpacing: -1, color: "#fff", margin: "0 0 8px" };
const muted: React.CSSProperties = { color: C.midnight, fontSize: 13, margin: "8px 0 0" };
const yes: React.CSSProperties = { border: "none", background: C.blue, color: "#fff", fontWeight: 700, fontSize: 14, padding: "11px 38px", borderRadius: 65, cursor: "pointer" };
const no: React.CSSProperties = { border: "2px solid #fff", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 14, padding: "10px 30px", borderRadius: 65, cursor: "pointer" };
const ghost: React.CSSProperties = { border: "2px solid #fff", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 14, padding: "10px 28px", borderRadius: 65, cursor: "pointer", marginTop: 14 };
const listBlock: React.CSSProperties = { marginTop: 16, textAlign: "left" };
const listLabel: React.CSSProperties = { color: C.midnight, fontSize: 12, fontWeight: 700, marginBottom: 8 };
const chipRow: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-start" };
const chip: React.CSSProperties = { background: C.cream, color: C.midnight, fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 65 };
