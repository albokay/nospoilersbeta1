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
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { getPeopleGroupInvite, acceptPeopleGroupInvite, type GroupInviteInfo } from "../lib/db";
import SidebarLogo from "./SidebarLogo";

const C = { green: "#7ABD8E", blue: "#355EB8", yellow: "#DEA838", red: "#F45028", cream: "#FEF8EA", midnight: "#1A3A4A" };
const LORA = '"Lora", Georgia, serif';

type Status = "loading" | "ready" | "invalid" | "expired" | "already" | "wrong" | "joining" | "done" | "error";

export default function GroupInviteAcceptPage({ token }: { token: string }) {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<GroupInviteInfo | null>(null);
  const [masked, setMasked] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getPeopleGroupInvite(token);
      if (cancelled) return;
      if (!res.ok) {
        setStatus(res.error === "expired" ? "expired" : res.error === "already_accepted" ? "already" : "invalid");
        return;
      }
      setInfo(res.info);
      setStatus("ready");
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function join() {
    setStatus("joining");
    const res = await acceptPeopleGroupInvite(token);
    if (res.ok) { setStatus("done"); setTimeout(() => navigate("/dashboard", { replace: true }), 900); return; }
    if (res.error === "wrong_recipient") { setMasked(res.maskedEmail); setStatus("wrong"); return; }
    if (res.error === "already_accepted") { setStatus("already"); return; }
    if (res.error === "expired") { setStatus("expired"); return; }
    setStatus("error");
  }

  const others = info ? info.memberNames.filter((n) => n) : [];
  const names = others.length
    ? others.map((n) => `@${n}`).reduce((acc, n, i, arr) => (i === 0 ? n : i === arr.length - 1 ? `${acc} and ${n}` : `${acc}, ${n}`), "")
    : `@${info?.inviterName ?? "someone"}`;

  return (
    <div style={page}>
      <div style={{ position: "absolute", top: 16, left: 20 }}><SidebarLogo scale={0.5} blocksOpacity={1} /></div>
      <div style={card}>
        {status === "loading" && <p style={muted}>Loading…</p>}

        {status === "ready" && (
          !user && !authLoading ? (
            <>
              <p style={title}>Join a group with {names}?</p>
              <p style={muted}>Sign in with the invited email first, then reopen this link.</p>
              <button style={ghost} onClick={() => navigate("/")}>Go to sign in</button>
            </>
          ) : (
            <>
              <p style={title}>Join a group with {names}?</p>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
                <button style={yes} onClick={join}>Yes</button>
                <button style={no} onClick={() => navigate("/dashboard")}>no</button>
              </div>
            </>
          )
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
const yes: React.CSSProperties = { border: `2px solid ${C.blue}`, background: C.cream, color: C.blue, fontWeight: 700, fontSize: 14, padding: "10px 36px", borderRadius: 65, cursor: "pointer" };
const no: React.CSSProperties = { border: "2px solid #fff", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 14, padding: "10px 30px", borderRadius: 65, cursor: "pointer" };
const ghost: React.CSSProperties = { border: "2px solid #fff", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 14, padding: "10px 28px", borderRadius: 65, cursor: "pointer", marginTop: 14 };
