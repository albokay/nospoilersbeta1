import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import LoadingDots from "./LoadingDots";

// Top-level utility route. Lives at /reset-password, mounted as an early-
// return in App.tsx so it bypasses AppShell (and thus the mobile lockout
// + auth-routing redirects + v2/v3 chrome). BetaGate also exempts this
// path so the recovery token in the URL hash isn't lost mid-flow.
//
// Flow:
//   1. User clicks the recovery link in their email — it lands here with
//      a #access_token=...&type=recovery URL hash.
//   2. supabase-js parses the hash on page load, signs the user in via
//      the recovery token, and fires onAuthStateChange with event
//      "PASSWORD_RECOVERY". We capture that event to flip the form on.
//   3. If the user lands here without that event (bookmarked the URL,
//      token expired before the page mounted), we show a no-token state
//      after a short grace window — supabase needs a tick to fire the
//      event after the hash parse.
//   4. On submit, supabase.auth.updateUser({ password }) persists the
//      change. Success → brief confirmation → redirect to /.

const COPY = {
  heading: "set a new password",
  subline: "you're signed in via a recovery link. choose a new password to finish.",
  newPasswordLabel: "new password",
  confirmLabel: "confirm new password",
  submit: "update password",
  cancel: "never mind, take me back",
  successHeading: "password updated",
  noTokenMessage: "this page only works from a password recovery email. did you mean to sign in?",
  noTokenAction: "go to sign-in",
};

type Phase = "waiting-for-recovery" | "ready" | "submitting" | "success" | "no-token";

const MIN_PASSWORD_LENGTH = 8;
// Grace period for the recovery session to materialize. supabase-js parses
// the URL hash on the supabase client's own init, which can fire BEFORE
// this component's subscription is in place — meaning we'd miss the
// PASSWORD_RECOVERY event entirely. The mount-time getSession() check
// catches that race; the timer is a fallback for the genuine no-token
// case (bookmarked URL, expired token). 3s is generous for a slow tab.
const NO_TOKEN_GRACE_MS = 3000;
const SUCCESS_REDIRECT_MS = 1500;

export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>("waiting-for-recovery");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Three convergent detection paths so we don't miss the recovery session:
  //   (1) Mount-time getSession() — catches the common case where supabase-js
  //       has already parsed the URL hash + signed the user in via the
  //       recovery token before our subscription is set up. This was the
  //       observed bug in the first version: PASSWORD_RECOVERY fired during
  //       supabase client init (before our useEffect ran), our subscription
  //       missed it, and the grace timer flipped us to no-token even though
  //       the recovery had succeeded.
  //   (2) onAuthStateChange — catches PASSWORD_RECOVERY (and SIGNED_IN as
  //       a belt-and-suspenders fallback) for the case where the parse
  //       finishes after our subscription is in place.
  //   (3) Grace timer — only flips to no-token if neither (1) nor (2) ever
  //       gave us a session. Covers the genuine no-token case (bookmarked
  //       URL, expired token).
  // The cancelled flag prevents state writes after unmount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.user) setPhase("ready");
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session?.user) {
        setPhase("ready");
      }
    });
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (phaseRef.current === "waiting-for-recovery") {
        setPhase("no-token");
      }
    }, NO_TOKEN_GRACE_MS);
    return () => {
      cancelled = true;
      subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  // Auto-redirect after success. window.location.assign forces a fresh App
  // mount so all auth-state-dependent UI re-evaluates against the user's
  // now-authenticated session (matches the HANDOFF "hard reload after
  // state-changing flows that bypass App state" pattern).
  useEffect(() => {
    if (phase !== "success") return;
    const t = window.setTimeout(() => {
      window.location.assign("/");
    }, SUCCESS_REDIRECT_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const next = newPassword.trim();
    const confirm = confirmPassword.trim();
    if (!next || !confirm) {
      setError("Both fields are required.");
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setPhase("submitting");
    const { error: updateErr } = await supabase.auth.updateUser({ password: next });
    if (updateErr) {
      setError(updateErr.message || "Couldn't update your password. Try again.");
      setPhase("ready");
      return;
    }
    setPhase("success");
  }

  // ── Common chrome ──────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px 20px",
      background: "var(--dos-bg)",
      color: "var(--dos-fg)",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 420,
        background: "rgba(253,248,236,0.06)",
        border: "2px solid rgba(253,248,236,0.18)",
        borderRadius: 16,
        padding: "28px 32px",
      }}>
        {phase === "no-token" ? (
          <NoTokenView />
        ) : phase === "success" ? (
          <SuccessView />
        ) : (
          <FormView
            phase={phase}
            newPassword={newPassword}
            confirmPassword={confirmPassword}
            onChangeNew={setNewPassword}
            onChangeConfirm={setConfirmPassword}
            onSubmit={handleSubmit}
            error={error}
          />
        )}
      </div>
    </div>
  );
}

function FormView({
  phase, newPassword, confirmPassword, onChangeNew, onChangeConfirm, onSubmit, error,
}: {
  phase: Phase;
  newPassword: string;
  confirmPassword: string;
  onChangeNew: (v: string) => void;
  onChangeConfirm: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string | null;
}) {
  const submitting = phase === "submitting";
  const waiting = phase === "waiting-for-recovery";
  return (
    <>
      <h1 style={{ margin: "0 0 10px", fontSize: 22, fontWeight: 700, color: "#FEF8EA" }}>
        {COPY.heading}
      </h1>
      <p style={{ margin: "0 0 22px", fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 14, lineHeight: 1.5, color: "rgba(253,248,236,0.75)" }}>
        {COPY.subline}
      </p>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input
          className="badge"
          type="password"
          placeholder={COPY.newPasswordLabel}
          value={newPassword}
          onChange={(e) => onChangeNew(e.target.value)}
          style={{ height: 40, width: "100%" }}
          autoComplete="new-password"
          autoFocus
          disabled={waiting || submitting}
        />
        <input
          className="badge"
          type="password"
          placeholder={COPY.confirmLabel}
          value={confirmPassword}
          onChange={(e) => onChangeConfirm(e.target.value)}
          style={{ height: 40, width: "100%" }}
          autoComplete="new-password"
          disabled={waiting || submitting}
        />
        {error && (
          <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{error}</div>
        )}
        <button
          className="btn btn-danger"
          type="submit"
          disabled={waiting || submitting}
          style={{ height: 40, marginTop: 4 }}
        >
          {submitting ? <LoadingDots /> : COPY.submit}
        </button>
      </form>
      <div style={{ marginTop: 16, textAlign: "center" }}>
        <a
          href="/"
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontStyle: "italic",
            fontSize: 13,
            color: "rgba(253,248,236,0.7)",
            textDecoration: "none",
            borderBottom: "1px dotted rgba(253,248,236,0.45)",
            paddingBottom: 1,
          }}
        >
          {COPY.cancel}
        </a>
      </div>
    </>
  );
}

function SuccessView() {
  return (
    <div style={{ textAlign: "center" }}>
      <h1 style={{ margin: "0 0 10px", fontSize: 22, fontWeight: 700, color: "#FEF8EA" }}>
        {COPY.successHeading}
      </h1>
      <p style={{ margin: 0, fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 14, color: "rgba(253,248,236,0.75)" }}>
        signing you in<LoadingDots />
      </p>
    </div>
  );
}

function NoTokenView() {
  return (
    <>
      <p style={{ margin: "0 0 18px", fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 15, lineHeight: 1.5, color: "rgba(253,248,236,0.85)", textAlign: "center" }}>
        {COPY.noTokenMessage}
      </p>
      <div style={{ textAlign: "center" }}>
        <a
          href="/"
          style={{
            display: "inline-block",
            background: "var(--dos-user)",
            color: "#FEF8EA",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
            borderRadius: 9999,
            padding: "10px 22px",
          }}
        >
          {COPY.noTokenAction}
        </a>
      </div>
    </>
  );
}
