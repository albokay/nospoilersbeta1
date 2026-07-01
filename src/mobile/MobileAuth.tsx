import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import LoadingDots from "../components/LoadingDots";

type Mode = "signin" | "signup";

// Sanitize a returnTo query parameter — only allow paths inside /m/* so a
// crafted invite URL can't bounce the user to an external origin or to a
// desktop route after auth. Falls back to /m/rooms on any anomaly.
function safeReturnTo(raw: string | null): string {
  if (!raw) return "/m/rooms";
  if (!raw.startsWith("/m/")) return "/m/rooms";
  // Defense: reject protocol-relative URLs and backslash variants. Both
  // are well-known open-redirect smuggling patterns.
  if (raw.includes("//") || raw.includes("\\")) return "/m/rooms";
  return raw;
}

// S2 — Full-screen mobile auth. Mirrors AuthModal's flow exactly (same
// signIn/signUp calls, same validation, same error shape) — only the UI
// is rebuilt for mobile: full-viewport layout, large touch targets,
// 16px font on inputs to avoid iOS focus-zoom.
//
// On success: navigate to ?returnTo or /m/rooms (default), with replace
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

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // After a sign-up when "Confirm email" is enabled: account exists but has no
  // session until the emailed link is clicked. Show a confirm screen instead
  // of navigating into the app.
  const [confirmSent, setConfirmSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

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
    border: "2px solid rgba(255,255,255,0.4)",
    borderRadius: 10,
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    outline: "none",
    boxSizing: "border-box",
    WebkitAppearance: "none",
  };

  // ── CONFIRM-EMAIL SENT — shown after sign-up when "Confirm email" is on. ──
  if (confirmSent) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "var(--dos-bg, #7abd8e)",
        color: "#fff",
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
            We sent a confirmation link to <strong>{email.trim()}</strong>. Tap it to finish setting up your account — it'll sign you in automatically.
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
      minHeight: "100vh",
      background: "var(--dos-bg, #7abd8e)",
      color: "#fff",
      padding: "32px 20px",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{ width: "100%", maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", flex: 1 }}>
        {/* ── Header ── */}
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: "16px 0 6px", textAlign: "center" }}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>
        <p style={{ fontSize: 14, opacity: 0.85, margin: "0 0 28px", textAlign: "center" }}>
          {mode === "signin" ? "Welcome back." : "Pick a username your friends will recognize."}
        </p>

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
            autoFocus={mode === "signin"}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            className="m-input"
            style={inputStyle}
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
              color: "#fff",
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
              background: "#fff",
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

        {/* ── Mode toggle ── */}
        <div style={{ marginTop: 20, textAlign: "center", fontSize: 14 }}>
          {mode === "signin" ? (
            <>No account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signup"); setError(null); }}
                style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}
              >
                Create one
              </button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signin"); setError(null); }}
                style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}
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
              color: "#fff",
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
