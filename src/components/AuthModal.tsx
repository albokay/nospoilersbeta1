import React, { useState } from "react";
import { X } from "lucide-react";
import Modal from "./Modal";
import { CANON } from "../styles/canon";
import { D } from "./dashboardChrome";
import LoadingDots from "./LoadingDots";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import { maskEmailEnds } from "../lib/utils";
import { useEditorial } from "../lib/skin";
import { E } from "../styles/editorial";
import { CornerTab, UnderlineWord } from "./editorial/Chrome";
import { pageStyle, COLUMN, FORM_CSS, Field, Block, Frame, Wordmark } from "./editorial/Onboarding";

type Mode = "signin" | "signup" | "recovery";

// Cream Form card (polish pass 2026-09-15): dark ink, cream fields with the
// sky ring, identity L submit — the auth card joins the site's card system.
const authCard: React.CSSProperties = {
  ...D.card.form, background: CANON.cream, color: CANON.dark, textAlign: "left",
};
const authTitle: React.CSSProperties = { ...D.type.title, color: CANON.personal, margin: 0 };
const authField: React.CSSProperties = { ...D.input, ...D.inputOnCream };
const authLink: React.CSSProperties = {
  background: "none", border: 0, textDecoration: "underline", cursor: "pointer",
  color: CANON.identity, fontSize: 14, fontWeight: 700, fontFamily: "inherit", padding: 12, margin: -12,
};
const authSubmit: React.CSSProperties = {
  ...D.pill.L, width: "100%", background: CANON.identity, color: CANON.cream, marginTop: 4,
};
const authX: React.CSSProperties = {
  width: 44, height: 44, border: "none", background: "transparent", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  color: CANON.dark, margin: "-10px -10px 0 0", borderRadius: "50%",
};

export default function AuthModal({ onClose, onSuccess, hint, initialMode = "signin", initialEmail = "", lockEmail = false, signupRedirectTo }: { onClose: () => void; onSuccess?: (mode: Mode) => void; hint?: string; initialMode?: Mode; initialEmail?: string; lockEmail?: boolean; signupRedirectTo?: string }) {
  const { signIn, signUp } = useAuth();
  const editorial = useEditorial();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
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
      if (!firstName.trim()) { setError("Please enter your first name."); setLoading(false); return; }
      if (firstName.trim().length > 40) { setError("That name is a little long — 40 characters max."); setLoading(false); return; }
      if (password.length < 8) { setError("Password must be at least 8 characters."); setLoading(false); return; }
      const redirect = signupRedirectTo ?? (typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined);
      const res = await signUp(email.trim(), password, firstName.trim(), redirect ? { emailRedirectTo: redirect } : undefined);
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

  // ── The editorial skin (checkpoint 7, 2026-10-12; the D3InvAuth board, the
  // bible's Form): the account form as a full-window page on cream — the
  // sky band, the wordmark, the line in Lora, the fields on rules, the block.
  if (editorial) {
    const para: React.CSSProperties = { ...E.type.body15, lineHeight: 1.6, margin: "0 0 12px" };
    const note: React.CSSProperties = { ...E.type.note13, lineHeight: 1.5, color: E.color.inkSub, margin: 0 };
    const err: React.CSSProperties = { ...E.type.note13, color: E.color.alert, fontWeight: 600, marginTop: 12 };
    const title = confirmSent ? "Check your email" : mode === "recovery" ? "Reset your password" : (hint ?? (mode === "signin" ? "Sign in to Sidebar." : "Create your account."));
    let body: React.ReactNode;
    if (confirmSent) {
      body = (
        <>
          <p style={para}>We sent a confirmation link to <strong>{maskEmailEnds(email.trim())}</strong>. Click it to finish setting up your account — it&rsquo;ll sign you in automatically.</p>
          <p style={para}>You can close this tab. The link opens Sidebar in a new one.</p>
          <p style={{ ...note, marginTop: 12 }}>It can take a minute to arrive. If you don&rsquo;t see it, check your spam folder.</p>
        </>
      );
    } else if (mode === "recovery") {
      body = recoverySent ? (
        <>
          <p style={para}>We&rsquo;ve sent a recovery link to <strong>{maskEmailEnds(email.trim())}</strong>. Click the link in your email to set a new password.</p>
          <p style={{ ...note, marginTop: 12 }}>The link expires in about an hour. If you don&rsquo;t see it, check spam.</p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 28 }}>
            <UnderlineWord onClick={() => { setRecoverySent(false); setError(null); }}>Send again</UnderlineWord>
            <Frame onClick={() => switchMode("signin")} style={{ width: "auto", padding: "0 24px" }}>Back to sign in</Frame>
          </div>
        </>
      ) : (
        <>
          <p style={note}>Enter the email you signed up with. We&rsquo;ll send you a link to set a new password.</p>
          <form onSubmit={handleSubmit} style={{ marginTop: 28 }}>
            <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="name@example.com" autoFocus autoComplete="email" />
            {error && <div style={err}>{error}</div>}
            <Block type="submit" disabled={loading} style={{ marginTop: 36 }}>{loading ? <LoadingDots /> : "Send recovery email"}</Block>
          </form>
          <div style={{ marginTop: 14, textAlign: "center" }}><UnderlineWord onClick={() => switchMode("signin")}>Remembered it? Back to sign in</UnderlineWord></div>
        </>
      );
    } else {
      body = (
        <>
          <form onSubmit={handleSubmit}>
            {mode === "signup" && (
              <>
                <Field label="First name" value={firstName} onChange={setFirstName} placeholder="Sam" autoFocus autoComplete="given-name" maxLength={40} />
                <div style={{ fontFamily: E.font.interface, fontSize: 12, lineHeight: 1.5, color: "rgba(26,58,74,0.65)", marginTop: 8 }}>This is how you&rsquo;ll show up for your friends. Think of it like saving a name in their contact list.</div>
              </>
            )}
            <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="name@example.com" readOnly={lockEmail} autoFocus={mode === "signin" && !lockEmail} autoComplete="email" style={{ marginTop: mode === "signup" ? 24 : 0 }} />
            <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="" autoComplete={mode === "signin" ? "current-password" : "new-password"} style={{ marginTop: 24 }} />
            {error && <div style={err}>{error}</div>}
            <Block type="submit" disabled={loading} style={{ marginTop: 36 }}>{loading ? <LoadingDots /> : mode === "signin" ? "Sign in" : "Create account"}</Block>
          </form>
          <div style={{ marginTop: 14, textAlign: "center" }}>
            {mode === "signin"
              ? <UnderlineWord onClick={() => switchMode("signup")}>No account? Create one</UnderlineWord>
              : <UnderlineWord onClick={() => switchMode("signin")}>Already have an account? Sign in</UnderlineWord>}
          </div>
          {mode === "signin" && <div style={{ marginTop: 14, textAlign: "center" }}><UnderlineWord onClick={() => switchMode("recovery")}>Forgot password?</UnderlineWord></div>}
          {mode === "signup" && (
            <p style={{ ...note, marginTop: 24, textAlign: "center" }}>Sidebar only uses your email to sign you in and to send a daily update of your friends&rsquo; writing (only if there&rsquo;s new writing you haven&rsquo;t seen). Emails are never shared or sold.</p>
          )}
        </>
      );
    }
    return (
      <div style={pageStyle(1100)}>
        <style>{FORM_CSS}</style>
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 230, background: E.color.friend }} />
        <CornerTab kind="back" desktop onClick={onClose} zIndex={1112} />
        <div style={{ position: "absolute", left: "50%", top: 36, transform: "translateX(-50%)", zIndex: 3 }}><Wordmark height={34} /></div>
        <div style={{ ...COLUMN, position: "relative", zIndex: 2, paddingTop: 120 }}>
          <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: 34, lineHeight: 1.15, letterSpacing: "-0.01em", color: E.color.ink }}>{title}</div>
        </div>
        <div style={{ ...COLUMN, marginTop: 64, paddingBottom: 80 }}>{body}</div>
      </div>
    );
  }

  // ── CONFIRM-EMAIL SENT — shown after sign-up when "Confirm email" is on.
  if (confirmSent) {
    return (
      <Modal onClose={onClose} topContent={hint ? hint : undefined} cardStyle={authCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <h3 style={authTitle}>Check your email</h3>
          <button style={authX} onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 12px" }}>
          We sent a confirmation link to <strong>{maskEmailEnds(email.trim())}</strong>. Click it to finish setting up your account — it'll sign you in automatically.
        </p>
        <p style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 12px" }}>
          You can close this tab. The link opens Sidebar in a new one.
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
      <Modal onClose={onClose} topContent={hint ? hint : undefined} cardStyle={authCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <h3 style={authTitle}>
            Reset your password
          </h3>
          <button style={authX} onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        {recoverySent ? (
          <>
            <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.5 }}>
              We've sent a recovery link to <strong>{maskEmailEnds(email.trim())}</strong>. Click the link in your email to set a new password.
            </p>
            <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.5 }} className="muted">
              The link expires in about an hour. If you don't see it, check spam.
            </p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                onClick={() => { setRecoverySent(false); setError(null); }}
                style={authLink}
              >
                Send again
              </button>
              <button
                onClick={() => switchMode("signin")}
                style={{ ...D.pill.S, background: "transparent", border: `2px solid ${CANON.dark}`, color: CANON.dark }}
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
                placeholder="Email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={authField}
                autoFocus
                autoComplete="email"
              />

              {error && (
                <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{error}</div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{ ...authSubmit, opacity: loading ? 0.85 : 1 }}
              >
                {loading ? <LoadingDots /> : "Send recovery email"}
              </button>
            </form>

            <div style={{ marginTop: 14, textAlign: "center", fontSize: 13 }} className="muted">
              Remembered it?{" "}
              <button
                onClick={() => switchMode("signin")}
                style={authLink}
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
    <Modal onClose={onClose} topContent={hint ? hint : undefined} cardStyle={authCard}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <h3 style={authTitle}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </h3>
        <button style={authX} onClick={onClose} aria-label="Close"><X size={20} /></button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
        {mode === "signup" && (
          <>
            <input
              placeholder="your first name"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              style={authField}
              autoFocus
              autoComplete="given-name"
            />
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: CANON.dark, opacity: 0.8 }}>
              This is how you'll show up for your friends. Think of it like saving a name in their contact list — no need for a complicated handle.
            </p>
          </>
        )}
        <input
          placeholder="Email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          readOnly={lockEmail}
          style={{ ...authField, ...(lockEmail ? { opacity: 0.7, cursor: "not-allowed" } : null) }}
          autoFocus={mode === "signin" && !lockEmail}
          autoComplete="email"
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={authField}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 14, fontWeight: 600 }}>{error}</div>
        )}

        {/* Mode toggle ABOVE the submit (polish pass 2026-09-15, mobile
            parity — a first-time invitee must see the create path without
            scrolling past the button). */}
        <div style={{ textAlign: "center", fontSize: 14, color: CANON.dark }}>
          {mode === "signin" ? (
            <>No account?{" "}
              <button type="button" onClick={() => switchMode("signup")} style={authLink}>
                Create one
              </button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button type="button" onClick={() => switchMode("signin")} style={authLink}>
                Sign in
              </button>
            </>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{ ...authSubmit, opacity: loading ? 0.85 : 1 }}
        >
          {loading ? <LoadingDots /> : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      {mode === "signup" && (
        <p style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5, color: CANON.dark, opacity: 0.7 }}>
          Sidebar only uses your email to sign you in and to send a daily update of your friends&rsquo; writing (only if there&rsquo;s new writing you haven&rsquo;t seen). Emails are never shared or sold.
        </p>
      )}

      {mode === "signin" && (
        <div style={{ marginTop: 16, textAlign: "center", fontSize: 14 }}>
          <button
            onClick={() => switchMode("recovery")}
            style={authLink}
          >
            Forgot password?
          </button>
        </div>
      )}
    </Modal>
  );
}
