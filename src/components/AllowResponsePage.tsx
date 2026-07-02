import React, { useEffect, useState } from "react";
import { CANON } from "../styles/canon";
import { useNavigate } from "react-router-dom";
import { CircleCheck, AlertTriangle, MessageSquare } from "lucide-react";
import { useAuth } from "../lib/auth";
import { fetchPublicResponseRequest, approvePublicResponse } from "../lib/db";
import AuthModal from "./AuthModal";

// Landing page for the "Allow" link in the public-response-request email.
// The owner reviews the request and approves it; approving publishes the held
// response(s) and grants the requester blanket permission to respond to all of
// the owner's public writing. There's no decline action — ignoring the email
// is the denial (per spec). Approval requires the owner to be signed in as
// themselves, enforced by the SECURITY DEFINER RPCs (auth.uid() = owner_id).

type ReqInfo = {
  requesterUsername: string;
  showId: string;
  showName: string;
  message: string | null;
  requesterAhead: boolean;
  body: string | null;
};

type Status = "loading" | "not_available" | "ready" | "approving" | "done" | "error";

export default function AllowResponsePage({ id }: { id: string }) {
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<ReqInfo | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setStatus("loading");
    fetchPublicResponseRequest(id).then((r) => {
      if (cancelled) return;
      if (!r) { setStatus("not_available"); return; }
      setInfo(r);
      setStatus("ready");
    });
    return () => { cancelled = true; };
  }, [id, user, authLoading]);

  const handleApprove = async () => {
    setStatus("approving");
    const res = await approvePublicResponse(id);
    if (res.ok) {
      setStatus("done");
    } else {
      setErrMsg(res.error === "not_found_or_forbidden"
        ? "This request has already been handled, or it isn't yours to approve."
        : "Something went wrong. Please try again.");
      setStatus("error");
    }
  };

  // ── Not signed in ──────────────────────────────────────────────────────
  if (!authLoading && !user) {
    return (
      <>
        <Page>
          <Emoji><MessageSquare size={44} color="var(--icon-color)" /></Emoji>
          <h2 className="title" style={{ marginBottom: 8 }}>Approve a response</h2>
          <p className="muted" style={{ marginBottom: 24, maxWidth: 420 }}>
            Sign in to your account to review and allow this request.
          </p>
          <button
            className="btn"
            onClick={() => setShowAuth(true)}
            style={{ background: CANON.cream, border: "none", color: CANON.accent, padding: "10px 28px", fontSize: 15, fontWeight: 700 }}
          >
            Sign in
          </button>
        </Page>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} hint="Sign in to review the request." />}
      </>
    );
  }

  if (status === "loading" || authLoading) {
    return <Page><p className="muted">Loading…</p></Page>;
  }

  if (status === "not_available") {
    return (
      <Page>
        <Emoji><AlertTriangle size={44} color="var(--icon-color)" /></Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>Request not available</h2>
        <p className="muted" style={{ marginBottom: 24, maxWidth: 420 }}>
          This request has already been handled, or it isn't yours to approve.
        </p>
        <button className="btn" onClick={() => navigate("/journal")}>Go to your journal</button>
      </Page>
    );
  }

  if (status === "done") {
    return (
      <Page>
        <Emoji><CircleCheck size={44} color="var(--icon-color)" /></Emoji>
        <h2 className="title" style={{ marginBottom: 8 }}>Allowed</h2>
        <p className="muted" style={{ marginBottom: 24, maxWidth: 440 }}>
          @{info?.requesterUsername} can now respond to your public writing.{" "}
          {info?.requesterAhead
            ? "Their response will appear once you catch up to where they've watched."
            : "Their response is now published."}
        </p>
        <button
          className="btn"
          onClick={() => navigate(
            profile && info ? `/u/${profile.username}/show/${info.showId}/posts` : "/journal",
          )}
        >
          View your public room
        </button>
      </Page>
    );
  }

  // ── "ready" + "approving" + "error" ────────────────────────────────────
  return (
    <Page>
      <Emoji><MessageSquare size={44} color="var(--icon-color)" /></Emoji>
      <h2 className="title" style={{ marginBottom: 6 }}>Allow a response?</h2>
      <p style={{ fontSize: 15, color: "rgba(253,248,236,0.65)", marginBottom: 20, lineHeight: 1.5, maxWidth: 460 }}>
        <strong style={{ color: "var(--fg)" }}>@{info?.requesterUsername}</strong> would like to respond
        to your public writing on <strong style={{ color: "var(--fg)" }}>{info?.showName}</strong>.
      </p>

      {info?.message && (
        <p style={{
          fontSize: 14, fontStyle: "italic", color: "rgba(253,248,236,0.8)",
          maxWidth: 460, marginBottom: 16, padding: "12px 16px",
          background: "rgba(253,248,236,0.06)", borderLeft: "3px solid var(--canon-accent,#dea838)", borderRadius: 4, textAlign: "left",
        }}>
          "{info.message}"
        </p>
      )}

      {info?.requesterAhead ? (
        <p style={{ fontSize: 13, color: "rgba(253,248,236,0.55)", fontStyle: "italic", maxWidth: 460, marginBottom: 20, lineHeight: 1.5 }}>
          They've watched further than you have. If you approve, you'll see their response once you catch up.
        </p>
      ) : info?.body ? (
        <p style={{
          fontSize: 14, color: "var(--fg)", maxWidth: 460, marginBottom: 20,
          padding: "14px 18px", background: "rgba(253,248,236,0.06)", borderRadius: 8,
          whiteSpace: "pre-wrap", textAlign: "left", lineHeight: 1.55,
        }}>
          {info.body}
        </p>
      ) : null}

      <p style={{ fontSize: 13, color: "rgba(253,248,236,0.5)", maxWidth: 460, marginBottom: 24, lineHeight: 1.5 }}>
        Approving lets @{info?.requesterUsername} respond to <strong style={{ color: "rgba(253,248,236,0.7)" }}>all</strong> of your public writing, on every show.
      </p>

      {status === "error" && (
        <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 16, maxWidth: 420 }}>{errMsg}</p>
      )}

      <button
        className="btn"
        onClick={handleApprove}
        disabled={status === "approving"}
        style={{ background: CANON.cream, border: "none", color: CANON.accent, padding: "10px 28px", fontSize: 15, fontWeight: 700 }}
      >
        {status === "approving" ? "Allowing…" : `Allow @${info?.requesterUsername}`}
      </button>

      <p style={{ fontSize: 12, color: "rgba(253,248,236,0.35)", marginTop: 18, maxWidth: 420, lineHeight: 1.5 }}>
        To deny, just close this page — nothing is published unless you allow it.
      </p>
    </Page>
  );
}

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
