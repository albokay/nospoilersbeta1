import React, { useState } from "react";
import { X } from "lucide-react";
import Modal from "./Modal";
import LoadingDots from "./LoadingDots";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";

type Mode = "signin" | "signup" | "recovery";

export default function AuthModal({ onClose, onSuccess, hint, initialMode = "signin", initialEmail = "", lockEmail = false, signupRedirectTo }: { onClose: () => void; onSuccess?: (mode: Mode) => void; hint?: string; initialMode?: Mode; initialEmail?: string; lockEmail?: boolean; signupRedirectTo?: string }) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Shown after a sign-up when "Confirm email" is enabled: the account exists
  // but has no session until the emailed link is clicked. We stay on this
  // screen (don't call onSuccess / onClose) so the flow doesn't proceed as if
  // signed in.
  const [confirmSent, setConfirmSent] = useState(false);
  // Recovery-specific: shows the "check your email" confirmation after a
  // successful resetPasswordForEmail call. Stays in recovery mode so the
  // user can re-send if needed without re-entering their email.
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

    if (mode === "signup") {
      if (!username.trim()) { setError("Please choose a username."); setLoading(false); return; }
      if (username.trim().length < 3) { setError("Username must be at least 3 characters."); setLoading(false); return; }
      if (password.length < 8) { setError("Password must be at least 8 characters."); setLoading(false); return; }
      const redirect = signupRedirectTo ?? (typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined);
      const res = await signUp(email.trim(), password, username.trim(), redirect ? { emailRedirectTo: redirect } : undefined);
      setLoading(false);
      if (res.error) { setError(res.error); return; }
      if (res.needsConfirmation) { setConfirmSent(true); return; }
      onSuccess?.("signup");
      onClose();
      return;
    }

    let err: string | null = null;
    if (mode === "signin") {
      err = await signIn(email.trim(), password);
    } else {
      // recovery: trigger Supabase's resetPasswordForEmail with an explicit
      // redirectTo. The dashboard's "Send password recovery" button bypasses
      // the email-template URL override, so the API call is the only path
      // that reliably lands the user on /reset-password. Hardcoding the
      // production host because emails sent from any environment should
      // always land on the live recovery page (not localhost).
      const { error: rpcError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setLoading(false);
      if (rpcError) {
        // Supabase intentionally responds 200 even for non-existing emails
        // to prevent enumeration. So a real error here is unusual (rate
        // limit, network, malformed email).
        setError(rpcError.message || "Couldn't send recovery email. Try again.");
        return;
      }
      setRecoverySent(true);
      return;
    }

    setLoading(false);
    if (err) { setError(err); return; }
    onSuccess?.(mode);
    onClose();
  }

  // ── CONFIRM-EMAIL SENT — shown after sign-up when "Confirm email" is on.
  if (confirmSent) {
    return (
      <Modal onClose={onClose} topContent={hint ? hint : undefined}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <h3 className="title" style={{ margin: 0, fontSize: 20 }}>Check your email</h3>
          <button className="close-x" onClick={onClose}><X size={14} /></button>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 12px" }}>
          We sent a confirmation link to <strong>{email.trim()}</strong>. Click it to finish setting up your account — it'll sign you in automatically.
        </p>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
          It can take a minute to arrive. If you don't see it, check your spam folder.
        </p>
      </Modal>
    );
  }

  // ── RECOVERY MODE — separate render path so we don't have to thread
  //    "is this signin/signup or recovery?" through every input. ────────────
  if (mode === "recovery") {
    return (
      <Modal onClose={onClose} topContent={hint ? hint : undefined}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <h3 className="title" style={{ margin: 0, fontSize: 20 }}>
            Reset your password
          </h3>
          <button className="close-x" onClick={onClose}><X size={14} /></button>
        </div>

        {recoverySent ? (
          <>
            <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.5 }}>
              We've sent a recovery link to <strong>{email.trim()}</strong>. Click the link in your email to set a new password.
            </p>
            <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.5 }} className="muted">
              The link expires in about an hour. If you don't see it, check spam.
            </p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                onClick={() => { setRecoverySent(false); setError(null); }}
                style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: "var(--dos-fg)", fontSize: 13 }}
              >
                Send again
              </button>
              <button
                onClick={() => switchMode("signin")}
                className="btn"
                style={{ height: 36, fontSize: 13 }}
              >
                Back to sign in
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.5 }} className="muted">
              Enter the email you signed up with. We'll send you a link to set a new password.
            </p>
            <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
              <input
                className="badge"
                placeholder="Email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ height: 40, width: "100%" }}
                autoFocus
                autoComplete="email"
              />

              {error && (
                <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{error}</div>
              )}

              <button
                className="btn btn-danger"
                type="submit"
                disabled={loading}
                style={{ height: 40, marginTop: 4 }}
              >
                {loading ? <LoadingDots /> : "Send recovery email"}
              </button>
            </form>

            <div style={{ marginTop: 14, textAlign: "center", fontSize: 13 }} className="muted">
              Remembered it?{" "}
              <button
                onClick={() => switchMode("signin")}
                style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: "var(--dos-fg)", fontSize: 13 }}
              >
                Back to sign in
              </button>
            </div>
          </>
        )}
      </Modal>
    );
  }

  // ── SIGNIN / SIGNUP — original render path ─────────────────────────────
  return (
    <Modal onClose={onClose} topContent={hint ? hint : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <h3 className="title" style={{ margin: 0, fontSize: 20 }}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </h3>
        <button className="close-x" onClick={onClose}><X size={14} /></button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
        {mode === "signup" && (
          <input
            className="badge"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={{ height: 40, width: "100%" }}
            autoFocus
            autoComplete="off"
          />
        )}
        <input
          className="badge"
          placeholder="Email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          readOnly={lockEmail}
          style={{ height: 40, width: "100%", ...(lockEmail ? { opacity: 0.7, cursor: "not-allowed" } : null) }}
          autoFocus={mode === "signin" && !lockEmail}
          autoComplete="email"
        />
        <input
          className="badge"
          placeholder="Password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ height: 40, width: "100%" }}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{error}</div>
        )}

        <button
          className="btn btn-danger"
          type="submit"
          disabled={loading}
          style={{ height: 40, marginTop: 4 }}
        >
          {loading ? <LoadingDots /> : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      {mode === "signin" && (
        <div style={{ marginTop: 10, textAlign: "right", fontSize: 13 }}>
          <button
            onClick={() => switchMode("recovery")}
            style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: "var(--dos-fg)", fontSize: 13 }}
          >
            Forgot password?
          </button>
        </div>
      )}

      <div style={{ marginTop: 14, textAlign: "center", fontSize: 13 }} className="muted">
        {mode === "signin" ? (
          <>No account?{" "}
            <button
              onClick={() => switchMode("signup")}
              style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: "var(--dos-fg)", fontSize: 13 }}
            >
              Create one
            </button>
          </>
        ) : (
          <>Already have an account?{" "}
            <button
              onClick={() => switchMode("signin")}
              style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: "var(--dos-fg)", fontSize: 13 }}
            >
              Sign in
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
