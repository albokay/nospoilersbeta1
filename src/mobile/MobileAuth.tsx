import { CANON } from "../styles/canon";
import { M } from "./m";
import React, { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import LoadingDots from "../components/LoadingDots";
import { maskEmailEnds } from "../lib/utils";
import { useEditorial } from "../lib/skin";
import { E } from "../styles/editorial";
import { CornerTab, UnderlineWord } from "../components/editorial/Chrome";
import { FORM_CSS, Field, Block, Frame, Wordmark } from "../components/editorial/Onboarding";

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
  const editorial = useEditorial();
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
  const [firstName, setFirstName] = useState("");
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
      if (!firstName.trim()) { setError("Please enter your first name."); setLoading(false); return; }
      if (firstName.trim().length > 40) { setError("That name is a little long — 40 characters max."); setLoading(false); return; }
      if (password.length < 8) { setError("Password must be at least 8 characters."); setLoading(false); return; }
      // Confirmation link returns the user back into /m (the validated returnTo).
      const redirect = typeof window !== "undefined" ? `${window.location.origin}${returnTo}` : undefined;
      const res = await signUp(email.trim(), password, firstName.trim(), redirect ? { emailRedirectTo: redirect } : undefined);
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

  // Cream pill fields like every other input on /m (polish pass 2026-09-14;
  // auth was the one translucent-square exception).
  const inputStyle: React.CSSProperties = {
    ...M.input,
    WebkitAppearance: "none",
  };
  // Inline error (polish pass): cream text under the field, no box — the red
  // block was the app's only box-styled error.
  const errorStyle: React.CSSProperties = {
    color: CANON.cream,
    fontSize: 14,
    fontWeight: 600,
    padding: "0 24px",
    marginTop: -2,
  };

  // ── The editorial skin (checkpoint 7, 2026-10-12; the E3InvAuth board, the
  // bible's Form): the page on cream — the sky band, the wordmark, the line
  // in Lora, the fields on rules, the block; the folded corner as the back.
  if (editorial) {
    const back = () => {
      const b = new URLSearchParams(location.search).get("returnTo");
      navigate(b && b.startsWith("/m/") && !b.includes("//") ? b : "/m");
    };
    const para: React.CSSProperties = { ...E.type.body15, lineHeight: 1.6, margin: "0 0 12px" };
    const note: React.CSSProperties = { ...E.type.note13, lineHeight: 1.5, color: E.color.inkSub, margin: 0 };
    const err: React.CSSProperties = { ...E.type.note13, color: E.color.alert, fontWeight: 600, marginTop: 12 };
    const title = confirmSent ? "Check your email" : mode === "recovery" ? "Reset your password" : (hint ?? (mode === "signin" ? "Sign in to Sidebar." : "Create your account."));
    let body: React.ReactNode;
    if (confirmSent) {
      body = (
        <>
          <p style={para}>We sent a confirmation link to <strong>{maskEmailEnds(email.trim())}</strong>. Tap it to finish setting up your account — it&rsquo;ll sign you in automatically.</p>
          <p style={para}>You can close this tab. The link opens Sidebar in a new one.</p>
          <p style={{ ...note, marginTop: 12 }}>It can take a minute to arrive. If you don&rsquo;t see it, check your spam folder.</p>
        </>
      );
    } else if (mode === "recovery") {
      body = recoverySent ? (
        <>
          <p style={para}>We&rsquo;ve sent a recovery link to <strong>{maskEmailEnds(email.trim())}</strong>. Tap the link in your email to set a new password.</p>
          <p style={{ ...note, marginTop: 12 }}>The link expires in about an hour. If you don&rsquo;t see it, check spam.</p>
          <div style={{ marginTop: 24, textAlign: "center" }}><UnderlineWord onClick={() => { setRecoverySent(false); setError(null); }}>Send again</UnderlineWord></div>
          <Frame onClick={() => switchMode("signin")} style={{ marginTop: 20 }}>Back to sign in</Frame>
        </>
      ) : (
        <>
          <p style={note}>Enter the email you signed up with. We&rsquo;ll send you a link to set a new password.</p>
          <form onSubmit={handleSubmit} style={{ marginTop: 28 }}>
            <Field label="Email" type="email" inputMode="email" value={email} onChange={setEmail} placeholder="email" autoFocus autoComplete="email" autoCapitalize="none" autoCorrect="off" />
            {error && <div style={err}>{error}</div>}
            <Block type="submit" disabled={loading} style={{ marginTop: 32 }}>{loading ? <LoadingDots /> : "Send recovery email"}</Block>
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
                <Field label="Your first name" value={firstName} onChange={setFirstName} placeholder="your first name" autoFocus autoComplete="given-name" autoCorrect="off" maxLength={40} />
                <div style={{ fontFamily: E.font.interface, fontSize: 12, lineHeight: 1.5, color: "rgba(26,58,74,0.65)", marginTop: 8 }}>This is how you&rsquo;ll show up for your friends. Think of it like saving a name in their contact list.</div>
              </>
            )}
            <Field label="Email" type="email" inputMode="email" value={email} onChange={setEmail} placeholder="email" readOnly={lockEmail} autoFocus={mode === "signin" && !lockEmail} autoComplete="email" autoCapitalize="none" autoCorrect="off" style={{ marginTop: mode === "signup" ? 22 : 0 }} />
            <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="Password" autoComplete={mode === "signin" ? "current-password" : "new-password"} style={{ marginTop: 22 }} />
            {error && <div style={err}>{error}</div>}
            <Block type="submit" disabled={loading} style={{ marginTop: 32 }}>{loading ? <LoadingDots /> : mode === "signin" ? "Sign in" : "Create account"}</Block>
          </form>
          <div style={{ marginTop: 14, textAlign: "center" }}>
            {mode === "signin"
              ? <UnderlineWord onClick={() => { setMode("signup"); setError(null); }}>No account? Create one</UnderlineWord>
              : <UnderlineWord onClick={() => { setMode("signin"); setError(null); }}>Already have an account? Sign in</UnderlineWord>}
          </div>
          {mode === "signin" && <div style={{ marginTop: 14, textAlign: "center" }}><UnderlineWord onClick={() => switchMode("recovery")}>Forgot password?</UnderlineWord></div>}
          {mode === "signup" && (
            <p style={{ ...note, marginTop: 24, textAlign: "center" }}>Sidebar only uses your email to sign you in and to send a daily update of your friends&rsquo; writing (only if there&rsquo;s new writing you haven&rsquo;t seen). Emails are never shared or sold.</p>
          )}
        </>
      );
    }
    return (
      <div style={{ position: "relative", minHeight: "100dvh", background: E.color.cream, color: E.color.ink, fontFamily: E.font.interface, boxSizing: "border-box", padding: `0 ${E.space.gutter}px calc(env(safe-area-inset-bottom, 0px) + 32px)` }}>
        <style>{FORM_CSS}</style>
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 213, background: E.color.friend }} />
        <CornerTab kind="back" onClick={back} />
        <div style={{ position: "absolute", left: "50%", top: "calc(env(safe-area-inset-top, 0px) + 24px)", transform: "translateX(-50%)", zIndex: 3 }}><Wordmark height={26} /></div>
        <div style={{ position: "relative", zIndex: 2, paddingTop: "calc(env(safe-area-inset-top, 0px) + 110px)" }}>
          <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: 28, lineHeight: 1.15, letterSpacing: "-0.01em", color: E.color.ink }}>{title}</div>
        </div>
        <div style={{ marginTop: 58 }}>{body}</div>
      </div>
    );
  }

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
          <h1 style={{ ...M.type.display, margin: "16px 0 8px", textAlign: "center" }}>
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
                  style={inputStyle}
                />

                {error && <div style={errorStyle}>{error}</div>}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    ...M.pill.L,
                    fontSize: 16,
                    marginTop: 8,
                    width: "100%",
                    background: CANON.cream,
                    color: "var(--dos-bg)",
                    cursor: loading ? "default" : "pointer",
                    opacity: loading ? 0.85 : 1,
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
          <h1 style={{ ...M.type.display, margin: "0 0 14px" }}>Check your email</h1>
          <p style={{ fontSize: 16, lineHeight: 1.5, opacity: 0.95, margin: "0 0 12px" }}>
            We sent a confirmation link to <strong>{maskEmailEnds(email.trim())}</strong>. Tap it to finish setting up your account — it'll sign you in automatically.
          </p>
          <p style={{ fontSize: 16, lineHeight: 1.5, opacity: 0.95, margin: "0 0 12px" }}>
            You can close this tab. The link opens Sidebar in a new one.
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
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* ── Standard top bar (polish pass 2026-09-14): ONE back arrow —
             replaces both the old fixed × and the bottom "← Back"; same
             returnTo-aware exit (an invitee's context is preserved; else
             the homepage). ── */}
      <div style={M.topBar}>
        <button
          type="button"
          aria-label="Back"
          onClick={() => {
            const back = new URLSearchParams(location.search).get("returnTo");
            navigate(back && back.startsWith("/m/") && !back.includes("//") ? back : "/m");
          }}
          style={M.iconBtn}
        >
          <ArrowLeft size={20} color={CANON.cream} />
        </button>
      </div>
      <div style={{ width: "100%", maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", flex: 1, padding: "24px 16px 32px", boxSizing: "border-box" }}>
        {/* ── Header ── */}
        {hint && (
          <p style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, opacity: 0.95, margin: "12px 0 0", textAlign: "center" }}>
            {hint}
          </p>
        )}
        <h1 style={{ ...M.type.display, margin: "16px 0 8px", textAlign: "center" }}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>
        {mode === "signin" ? (
          <p style={{ ...M.type.body, opacity: 0.9, margin: "0 0 32px", textAlign: "center" }}>
            Welcome back.
          </p>
        ) : (
          <div style={{ height: 32 }} />
        )}

        {/* ── Form ── */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "signup" && (
            <>
              <input
                placeholder="your first name"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                autoFocus
                autoComplete="given-name"
                autoCorrect="off"
                style={inputStyle}
              />
              <p style={{ margin: "0 0 2px", fontSize: 13, lineHeight: 1.5, color: CANON.cream, opacity: 0.9 }}>
                This is how you'll show up for your friends. Think of it like saving a name in their contact list — no need for a complicated handle.
              </p>
            </>
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
            style={{ ...inputStyle, ...(lockEmail ? { opacity: 0.7 } : null) }}
          />
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            style={inputStyle}
          />

          {error && <div style={errorStyle}>{error}</div>}

          {/* Directly under the password field (Alborz 2026-08-01) — at the
              old bottom-of-screen spot the keyboard hid it, so a first-time
              invitee couldn't see how to create an account. Sign-up mode's
              "Already have an account?" takes the same slot. */}
          {mode === "signin" ? (
            <div style={{ padding: 12, textAlign: "center", fontSize: 14, color: CANON.cream }}>
              No account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signup"); setError(null); }}
                style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: CANON.cream, fontSize: 14, fontWeight: 700, fontFamily: "inherit", padding: 12, margin: -12 }}
              >
                Create one
              </button>
            </div>
          ) : (
            <div style={{ padding: 12, textAlign: "center", fontSize: 14, color: CANON.cream }}>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signin"); setError(null); }}
                style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: CANON.cream, fontSize: 14, fontWeight: 700, fontFamily: "inherit", padding: 12, margin: -12 }}
              >
                Sign in
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              ...M.pill.L,
              fontSize: 16,
              width: "100%",
              background: CANON.cream,
              color: "var(--dos-bg)",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.85 : 1,
            }}
          >
            {loading ? <LoadingDots /> : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {mode === "signup" && (
          <p style={{ marginTop: 14, fontSize: 13, lineHeight: 1.5, opacity: 0.8, textAlign: "center" }}>
            Sidebar only uses your email to sign you in and to send a daily update of your friends&rsquo; writing (only if there&rsquo;s new writing you haven&rsquo;t seen). Emails are never shared or sold.
          </p>
        )}

        {mode === "signin" && (
          <div style={{ marginTop: 8, textAlign: "center", fontSize: 14 }}>
            <button
              type="button"
              onClick={() => switchMode("recovery")}
              style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: CANON.cream, fontSize: 14, fontWeight: 700, fontFamily: "inherit", opacity: 0.9, padding: 12 }}
            >
              Forgot password?
            </button>
          </div>
        )}

        {/* (The bottom "← Back" collapsed into the top bar's arrow —
            polish pass 2026-09-14.) */}
      </div>
    </div>
  );
}
