import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/auth";
import AuthModal from "./AuthModal";

type InviteInfo = {
  id: string;
  group_id: string;
  group_name: string;
  show_id: string | null;
  expires_at: string;
};

type Status =
  | "loading"
  | "invalid"
  | "expired"
  | "already_accepted"
  | "ready"
  | "accepting"
  | "done"
  | "error";

export default function InviteAcceptPage({ token }: { token: string }) {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus]   = useState<Status>("loading");
  const [invite, setInvite]   = useState<InviteInfo | null>(null);
  const [errMsg, setErrMsg]   = useState("");
  const [showAuth, setShowAuth] = useState(false);

  // Load invite info (no auth needed — SECURITY DEFINER RPC)
  useEffect(() => {
    supabase
      .rpc("get_invitation_by_token", { p_token: token })
      .then(({ data, error }) => {
        if (error || !data) { setStatus("invalid"); return; }
        setInvite(data as InviteInfo);
        setStatus("ready");
      });
  }, [token]);

  async function handleAccept() {
    if (!user) { setShowAuth(true); return; }
    setStatus("accepting");

    const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });

    if (error || !data?.ok) {
      const code = (data as any)?.error ?? error?.message ?? "unknown";
      if      (code === "already_accepted") setStatus("already_accepted");
      else if (code === "expired")          setStatus("expired");
      else { setErrMsg(code); setStatus("error"); }
      return;
    }

    setStatus("done");
    // Navigate home after a short delay — let the user find the show themselves
    // since they may not have set up progress for it yet
    setTimeout(() => navigate("/"), 1800);
  }

  // If the user just signed in / signed up via the auth modal, auto-accept
  useEffect(() => {
    if (user && status === "ready" && showAuth) {
      setShowAuth(false);
      handleAccept();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (authLoading || status === "loading") {
    return (
      <Page>
        <p className="muted" style={{ fontSize: 14 }}>Loading…</p>
      </Page>
    );
  }

  if (status === "invalid") {
    return (
      <Page>
        <Emoji>🔗</Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>Invalid invitation</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          This invite link doesn't exist, has already been used, or has expired.
        </p>
        <button className="btn" onClick={() => navigate("/")}>Go home</button>
      </Page>
    );
  }

  if (status === "expired") {
    return (
      <Page>
        <Emoji>⏰</Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>Invitation expired</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          This invite link expired. Ask the room creator to send a new one.
        </p>
        <button className="btn" onClick={() => navigate("/")}>Go home</button>
      </Page>
    );
  }

  if (status === "already_accepted") {
    return (
      <Page>
        <Emoji>✅</Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>Already joined</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          This invitation has already been accepted — you may already be in the room.
        </p>
        <button
          className="btn"
          onClick={() => navigate(invite?.show_id ? `/show/${invite.show_id}` : "/")}
        >
          Go to show
        </button>
      </Page>
    );
  }

  if (status === "done") {
    return (
      <Page>
        <Emoji>🎉</Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>You're in!</h2>
        <p className="muted">
          Joining <strong style={{ color: "var(--fg)" }}>"{invite?.group_name}"</strong>…
          taking you there now.
        </p>
      </Page>
    );
  }

  if (status === "error") {
    return (
      <Page>
        <Emoji>⚠️</Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>Something went wrong</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          {errMsg || "Could not accept the invitation. Please try again."}
        </p>
        <button className="btn" onClick={() => navigate("/")}>Go home</button>
      </Page>
    );
  }

  // ── "ready" state ──────────────────────────────────────────────────────────
  return (
    <>
      <Page>
        <Emoji>🎬</Emoji>
        <h2 className="title" style={{ marginBottom: 6 }}>You're invited!</h2>
        <p style={{ fontSize: 15, color: "rgba(255,255,255,0.65)", marginBottom: 28, lineHeight: 1.5 }}>
          Join the private watch room{" "}
          <strong style={{ color: "var(--fg)" }}>"{invite?.group_name}"</strong>
        </p>

        {!user ? (
          <>
            <p style={{ fontSize: 13, opacity: 0.5, marginBottom: 16 }}>
              Sign in or create a free account to join.
            </p>
            <button
              className="btn"
              onClick={() => setShowAuth(true)}
              style={{ background: "var(--green)", border: "none", color: "#fff", padding: "10px 28px", fontSize: 15 }}
            >
              Sign in to accept
            </button>
          </>
        ) : (
          <button
            className="btn"
            onClick={handleAccept}
            disabled={status === "accepting"}
            style={{ background: "var(--green)", border: "none", color: "#fff", padding: "10px 28px", fontSize: 15 }}
          >
            {(status as string) === "accepting" ? "Joining…" : `Join "${invite?.group_name}"`}
          </button>
        )}

        {invite && (
          <p style={{ fontSize: 11, opacity: 0.35, marginTop: 20 }}>
            Expires {new Date(invite.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </p>
        )}
      </Page>

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          hint={`Sign in to join "${invite?.group_name}" on No Spoilers`}
        />
      )}
    </>
  );
}

// ── Layout helpers ─────────────────────────────────────────────────────────────

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      padding: "0 24px",
      gap: 6,
    }}>
      {children}
    </div>
  );
}

function Emoji({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 44, marginBottom: 4, lineHeight: 1 }}>{children}</div>;
}
