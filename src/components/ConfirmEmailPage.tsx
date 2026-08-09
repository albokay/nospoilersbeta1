/**
 * ConfirmEmailPage — /confirm (Alborz's 2026-08-01 catch: "confirm email
 * lands on the homepage signed OUT, forced to sign in").
 *
 * The old flow rode entirely on GoTrue's one-shot verify link: the email's
 * button hit /auth/v1/verify directly and the session came back in a URL
 * hash — fragile in exactly the ways users hit (mail-client link prefetch
 * consuming the token, a second click, the hash being processed late or
 * lost across redirects), and when it broke, the fallback was the homepage,
 * signed out, with no explanation.
 *
 * Now the email's button lands HERE with a token_hash in the query string
 * and WE verify it (supabase.auth.verifyOtp) — the Supabase-recommended
 * hardening for this symptom: scanners that prefetch the link don't run
 * JS, so they can't consume the token; the session is established by an
 * explicit call in the clicking browser (no hash race); and the post-
 * confirm destination rides a ?next= param through our own navigation, so
 * an invitee still lands back on their invite. Failure gets a real screen:
 * "confirmed already / expired — sign in", not a bare homepage.
 *
 * Requires the confirmation email template's link to be:
 *   {{ .SiteURL }}/confirm?token_hash={{ .TokenHash }}&type=signup&next={{ .RedirectTo }}
 * (Template updated by Alborz in the Supabase dashboard.)
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import SidebarLogo from "./SidebarLogo";
import LoadingDots from "./LoadingDots";
import { CANON } from "../styles/canon";

/** ?next= arrives as the signup's full redirect URL. Same-origin paths only
 *  (open-redirect guard); anything else falls back to the default landing. */
function safeNextPath(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    if (!url.pathname.startsWith("/")) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}

export default function ConfirmEmailPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<"verifying" | "failed">("verifying");
  const ranRef = useRef(false); // StrictMode double-mount guard — the token is one-shot

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const type = params.get("type") ?? "signup";
    const next = safeNextPath(params.get("next"));
    (async () => {
      // Already signed in (e.g. the link was clicked twice and the first
      // click won)? Just proceed — nothing to verify.
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) { navigate(next ?? "/", { replace: true }); return; }
      if (!tokenHash) { setState("failed"); return; }
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "signup" | "email" });
      if (error) { setState("failed"); return; }
      // Session established in THIS browser. The app's just-signed-in
      // routing takes over from the destination.
      navigate(next ?? "/", { replace: true });
    })();
  }, [navigate]);

  return (
    <div style={page}>
      <div style={{ position: "absolute", top: 16, left: 20 }}><SidebarLogo scale={0.5} blocksOpacity={1} /></div>
      {state === "verifying" ? (
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: CANON.cream }}>
          confirming your email<LoadingDots />
        </span>
      ) : (
        <div style={card}>
          <p style={{ margin: "0 0 10px", fontFamily: '"Lora", Georgia, serif', fontWeight: 700, fontSize: 20, color: CANON.dark }}>
            This confirmation link has expired or was already used.
          </p>
          <p style={{ margin: "0 0 24px", fontSize: 14, lineHeight: 1.55, color: CANON.dark, opacity: 0.85 }}>
            Your email may already be confirmed &mdash; try signing in.
          </p>
          <button style={signInBtn} onClick={() => navigate("/", { replace: true })}>Sign in</button>
        </div>
      )}
    </div>
  );
}

const page: React.CSSProperties = {
  position: "fixed", inset: 0, background: CANON.personal, fontFamily: '"Inter", system-ui, sans-serif',
  display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
};
const card: React.CSSProperties = {
  background: CANON.cream, borderRadius: 15, padding: "32px 36px", width: "min(420px, 90vw)", textAlign: "center",
};
const signInBtn: React.CSSProperties = {
  border: "none", background: CANON.identity, color: CANON.cream, fontWeight: 700, fontSize: 14,
  padding: "13px 40px", borderRadius: 65, cursor: "pointer",
};
