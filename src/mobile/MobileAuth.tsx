import { CANON } from "../styles/canon";
import React, { useState } from "react";
import { X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import LoadingDots from "../components/LoadingDots";
import { maskEmailEnds } from "../lib/utils";

type Mode = "signin" | "signup" | "recovery";

// Sanitize a returnTo query parameter — only allow paths inside /m/* so a
// crafted invite URL can't bounce the user to an external origin or to a
// desktop route after auth. Falls back to /m/dashboard on any anomaly.
function safeReturnTo(raw: string | null): string {
  if (!raw) return "/m/dashboard";
  if (!raw.startsWith("/m/")) return "/m/dashboard";
  // Defense: reject protocol-relative URLs and backslash variants. Both
  // are well-known open-redirect smuggling patterns.
  if (raw.includes("//") || raw.includes("\\")) return "/m/dashboard";
  return raw;
}

// S2 — Full-screen mobile auth. Mirrors AuthModal's flow exactly (same
// signIn/signUp calls, same validation, same error shape) — only the UI
// is rebuilt for mobile: full-viewport layout, large touch targets,
// 16px font on inputs to avoid iOS focus-zoom.
//
// On success: navigate to ?returnTo or /m/dashboard (default), with replace
// so back-button doesn't return to the auth screen. returnTo is used by
// the invite-accept flow so a signed-out invitee can sign in / create an
// account and return to the invite-accept page to finish joining the
// room. Validated to /m/* paths only (see safeReturnTo above) to prevent
// open-redirect smuggling.
//
// The desktop App-level "navigate to /profile on null→user transition"
// effect lives in <AppShell> and is not mounted on /m/*, so there's no
// conflict — MobileAuth owns its own post-success navigation.
export default function MobileAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, signUp } = useAuth();
  const returnTo = safeReturnTo(new URLSearchParams(location.search).get("returnTo"));

  // ?mode=signup opens in create-account mode — the mobile idiom for
  // desktop's AuthModal initialMode="signup" (used by the homepage
  // "Join / sign in" CTA and HowItWorksV2's Join button).
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(location.search).get("mode") === "signup" ? "signup" : "signin"
  );
  // Invite-arrival support (mobile idiom of AuthModal's initialEmail /
  // lockEmail / hint props): ?email= prefills, ?lock=1 pins it to the
  // invited address, ?hint= renders a context line above the title.
  const params = new URLSearchParams(location.search);
  const lockEmail = params.get("lock") === "1";
  const hint = params.get("hint");
  const [email, setEmail] = useState(() => new URLSearchParams(location.search).get("email") ?? "");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // After a sign-up when "Confirm email" is enabled: account exists but has no
  // session until the emailed link is clicked. Show a confirm screen instead
  // of navigating into the app.
  const [confirmSent, setConfirmSent] = useState(false);
  // Recovery: shows the "check your email" confirmation after a successful
  // resetPasswordForEmail call. Stays in recovery mode so the user can
  // re-send without re-entering their email. (Mirrors AuthModal.)
  const [recoverySent, setRecoverySent] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setRecoverySent(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === "recovery") {
      // Same call + redirect as AuthModal: the emailed link lands on
      // /reset-password (top-level route, exempt from AppShell chrome).
      const { error: rpcError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setLoading(false);
      if (rpcError) {
        // Supabase responds 200 even for non-existing emails (enumeration
        // safety), so a real error here is unusual (rate limit, network).
        setError(rpcError.message || "Couldn't send recovery email. Try again.");
        return;
      }
      setRecoverySent(true);
      return;
    }

    if (mode === "signup") {
      if (!username.trim()) { setError("Please choose a username."); setLoading(false); return; }
      if (username.trim().length < 3) { setError("Username must be at least 3 characters."); setLoading(false); return; }
      if (password.length < 8) { setError("Password must be at least 8 characters."); setLoading(false); return; }
      // Confirmation link returns the user back into /m (the validated returnTo).
      const redirect = typeof window !== "undefined" ? `${window.location.origin}${returnTo}` : undefined;
      const res = await signUp(email.trim(), password, username.trim(), redirect ? { emailRedirectTo: redirect } : undefined);
      setLoading(false);
      if (res.error) { setError(res.error); return; }
      if (res.needsConfirmation) { setConfirmSent(true); return; }
      navigate(returnTo, { replace: true });
      return;
    }

    const err = await signIn(email.trim(), password);
    setLoading(false);
    if (err) { setError(err); return; }
    navigate(returnTo, { replace: true });
  }

  const inputStyle: React.CSSProperties = {
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
  };

  // ── RECOVERY MODE — separate render path, mirrors AuthModal's. ──────────
  if (mode === "recovery") {
    return (
      <div style={{
        minHeight: "100dvh",
        background: "var(--dos-bg, var(--canon-personal,#7abd8e))",
        color: CANON.cream,
        padding: "32px 20px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}>
        <div style={{ width: "100%", maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", flex: 1 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: "16px 0 6px", textAlign: "center" }}>
            Reset your password
          </h1>

          {recoverySent ? (
            <>
              <p style={{ fontSize: 16, lineHeight: 1.5, opacity: 0.95, margin: "22px 0 12px", textAlign: "center" }}>
                We've sent a recovery link to <strong>{maskEmailEnds(email.trim())}</strong>. Tap the link in your email to set a new password.
              </p>
              <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8, margin: "0 0 24px", textAlign: "center" }}>
                The link expires in about an hour. If you don't see it, check spam.
              </p>
              <button
                type="button"
                onClick={() => { setRecoverySent(false); setError(null); }}
                style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: CANON.cream, fontSize: 14, fontWeight: 700, fontFamily: "inherit", padding: "10px 0" }}
              >
                Send again
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 14, opacity: 0.85, margin: "0 0 28px", textAlign: "center", lineHeight: 1.5 }}>
                Enter the email you signed up with. We'll send you a link to set a new password.
              </p>
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input
                  placeholder="Email"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoFocus
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="m-input"
                  style={inputStyle}
                />

                {error && (
                  <div style={{
                    color: CANON.cream,
                    background: "rgba(244,80,40,0.9)",
                    padding: "10px 14px",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    marginTop: 4,
                  }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "16px 0",
                    fontSize: 18,
                    fontWeight: 800,
                    fontFamily: "inherit",
                    background: CANON.cream,
                    color: "var(--dos-bg)",
                    border: "none",
                    borderRadius: 9999,
                    cursor: loading ? "default" : "pointer",
                    opacity: loading ? 0.85 : 1,
                    letterSpacing: "0.02em",
                  }}
                >
                  {loading ? <LoadingDots /> : "Send recovery email"}
                </button>
              </form>
            </>
          )}

          <div style={{ marginTop: 20, textAlign: "center", fontSize: 14 }}>
            Remembered it?{" "}
            <button
              type="button"
              onClick={() => switchMode("signin")}
              style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: CANON.cream, fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── CONFIRM-EMAIL SENT — shown after sign-up when "Confirm email" is on. ──
  if (confirmSent) {
    return (
      <div style={{
        minHeight: "100dvh",
        background: "var(--dos-bg, var(--canon-personal,#7abd8e))",
        color: CANON.cream,
        padding: "32px 20px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
      }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 14px" }}>Check your email</h1>
          <p style={{ fontSize: 16, lineHeight: 1.5, opacity: 0.95, margin: "0 0 12px" }}>
            We sent a confirmation link to <strong>{maskEmailEnds(email.trim())}</strong>. Tap it to finish setting up your account — it'll sign you in automatically.
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8, margin: 0 }}>
            It can take a minute to arrive. If you don't see it, check your spam folder.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--dos-bg, var(--canon-personal,#7abd8e))",
      color: CANON.cream,
      padding: "32px 20px",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* ── Top-right × — same exit as the bottom "← Back" (returnTo-aware
             so an invitee's context is preserved; else the homepage). ── */}
      <button
        type="button"
        aria-label="Close"
        onClick={() => {
          const back = new URLSearchParams(location.search).get("returnTo");
          navigate(back && back.startsWith("/m/") && !back.includes("//") ? back : "/m");
        }}
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          right: 12,
          width: 44, height: 44,
          border: "none", background: "transparent", cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          zIndex: 10,
        }}
      >
        <X size={20} color={CANON.cream} />
      </button>
      <div style={{ width: "100%", maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", flex: 1 }}>
        {/* ── Header ── */}
        {hint && (
          <p style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, opacity: 0.95, margin: "12px 0 0", textAlign: "center" }}>
            {hint}
          </p>
        )}
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: "16px 0 6px", textAlign: "center" }}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>
        {mode === "signin" ? (
          <p style={{ fontSize: 14, opacity: 0.85, margin: "0 0 28px", textAlign: "center" }}>
            Welcome back.
          </p>
        ) : (
          <div style={{ height: 28 }} />
        )}

        {/* ── Form ── */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "signup" && (
            <input
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              className="m-input"
            style={inputStyle}
            />
          )}
          <input
            placeholder="Email"
            type="email"
            inputMode="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            readOnly={lockEmail}
            autoFocus={mode === "signin" && !lockEmail}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            className="m-input"
            style={{ ...inputStyle, ...(lockEmail ? { opacity: 0.7 } : null) }}
          />
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="m-input"
            style={inputStyle}
          />

          {error && (
            <div style={{
              color: CANON.cream,
              background: "rgba(244,80,40,0.9)",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              marginTop: 4,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 8,
              width: "100%",
              padding: "16px 0",
              fontSize: 18,
              fontWeight: 800,
              fontFamily: "inherit",
              background: CANON.cream,
              color: "var(--dos-bg)",
              border: "none",
              borderRadius: 9999,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.85 : 1,
              letterSpacing: "0.02em",
            }}
          >
            {loading ? <LoadingDots /> : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {mode === "signup" && (
          <p style={{ marginTop: 14, fontSize: 12, lineHeight: 1.5, opacity: 0.8, textAlign: "center" }}>
            Sidebar only uses your email to sign you in, send your friend invites, and send an occasional digest (only if your rooms have new activity you haven't seen) — emails are never shared or sold.
          </p>
        )}

        {mode === "signin" && (
          <div style={{ marginTop: 16, textAlign: "center", fontSize: 14 }}>
            <button
              type="button"
              onClick={() => switchMode("recovery")}
              style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: CANON.cream, fontSize: 14, fontWeight: 700, fontFamily: "inherit", opacity: 0.9 }}
            >
              Forgot password?
            </button>
          </div>
        )}

        {/* ── Mode toggle ── */}
        <div style={{ marginTop: 20, textAlign: "center", fontSize: 14 }}>
          {mode === "signin" ? (
            <>No account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signup"); setError(null); }}
                style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: CANON.cream, fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}
              >
                Create one
              </button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signin"); setError(null); }}
                style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: CANON.cream, fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}
              >
                Sign in
              </button>
            </>
          )}
        </div>

        {/* ── Back link ── */}
        <div style={{ marginTop: "auto", paddingTop: 32, textAlign: "center" }}>
          <button
            type="button"
            onClick={() => {
              // If the user arrived via ?returnTo (typically the invite
              // flow), Back returns to that origin so they don't lose the
              // invite context. Default Back goes to /m (the narrative).
              const back = new URLSearchParams(location.search).get("returnTo");
              navigate(back && back.startsWith("/m/") && !back.includes("//") ? back : "/m");
            }}
            style={{
              background: "transparent",
              color: CANON.cream,
              border: "none",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              opacity: 0.85,
              padding: "8px 12px",
            }}
          >
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
}
