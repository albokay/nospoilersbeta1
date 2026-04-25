import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, CheckCircle2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import {
  sendInvite,
  fetchAllFriendGroupsWithActivity,
} from "../lib/db";
import type { FriendGroup } from "../types";
import { maskEmail } from "../lib/utils";
import LoadingDots from "../components/LoadingDots";

// /m/rooms/:groupId/invite — send an email invitation to join the current
// room. Wraps the desktop sendInvite path (edge function call) without
// any data-shape changes; only the UI is mobile-rebuilt.
//
// Per HANDOFF the only callers of sendInvite must be the room creator
// (server-side enforces via "not_creator"); for mobile we don't gate
// the screen client-side because the error message handles it cleanly,
// AND a future "S7 dropdown" path on a room with multiple members will
// reuse this same screen — at which point member-but-not-creator is
// the most common reachable state.
//
// Recipient email is masked in the success card per HANDOFF convention
// (client-side length-matching mask via utils.maskEmail). Server-side
// recipient binding (accept_invitation's wrong_recipient response, see
// 2026-04-23 audit arc) keeps tokens scoped to the invited address.
export default function MobileInvite({ groupId }: { groupId: string }) {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [room, setRoom] = useState<FriendGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    fetchAllFriendGroupsWithActivity(user.id)
      .then(rooms => {
        if (cancelled) return;
        const r = rooms.find(x => x.id === groupId);
        if (!r) { setLoadError("not_member"); return; }
        setRoom(r);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("MobileInvite fetch failed:", err);
        setLoadError("fetch_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [groupId, user?.id]);

  const canSubmit =
    !!user && !!room &&
    email.trim().length > 0 &&
    !submitting;

  const onSubmit = async () => {
    if (!user || !room) return;
    setSubmitError(null);

    // Client-side self-invite pre-check for immediate feedback. The edge
    // function also rejects this server-side (returns "self_invite") so
    // a stale build can't bypass it. Mirrors the desktop pattern in
    // ShowSection.handleSendInvite.
    const trimmed = email.trim();
    const lowered = trimmed.toLowerCase();
    const callerEmail = user.email?.toLowerCase().trim();
    if (callerEmail && lowered === callerEmail) {
      setSubmitError("You can't invite yourself.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await sendInvite({
        groupId: room.id,
        groupName: room.name,
        inviteeEmail: trimmed,
        inviterName: profile?.username ?? "Someone",
      });
      if (!result.ok) {
        // Same error code → user-facing message map as desktop. Keep in
        // sync if either side adds new codes.
        const msgs: Record<string, string> = {
          rate_limit:      "You've reached the daily invitation limit. Try again tomorrow.",
          already_invited: "You've already invited this person.",
          not_creator:     "Only the room creator can send invitations.",
          invalid_email:   "Please enter a valid email address.",
          self_invite:     "You can't invite yourself.",
        };
        setSubmitError(msgs[result.error] ?? result.message ?? "Something went wrong. Please try again.");
      } else {
        setSentTo(trimmed);
        setEmail("");
      }
    } catch (err) {
      console.warn("MobileInvite submit failed:", err);
      setSubmitError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──

  const wrapper: React.CSSProperties = {
    minHeight: "100vh",
    background: "var(--dos-bg, #7abd8e)",
    color: "#fff",
    padding: "16px 20px 32px",
    boxSizing: "border-box",
  };

  if (loading) {
    return (
      <div style={{ ...wrapper, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 14, opacity: 0.85 }}>Loading<LoadingDots /></span>
      </div>
    );
  }

  if (loadError || !room) {
    return (
      <div style={{ ...wrapper, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <p style={{ fontSize: 14, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320 }}>
          {loadError === "not_member"  && "You're not in this room."}
          {loadError === "fetch_failed" && "Couldn't load the room. Try again."}
        </p>
        <button
          onClick={() => navigate("/m/rooms", { replace: true })}
          style={{
            background: "transparent", color: "#fff",
            border: "2px solid #fff",
            borderRadius: 9999, padding: "10px 24px",
            fontSize: 14, fontWeight: 700, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ← Back to rooms
        </button>
      </div>
    );
  }

  return (
    <div style={wrapper}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        {/* ── Header bar ── */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}>
          <button
            onClick={() => navigate(`/m/rooms/${groupId}`)}
            disabled={submitting}
            style={{
              background: "transparent", color: "#fff",
              border: "none",
              fontSize: 15, fontWeight: 600, cursor: submitting ? "default" : "pointer",
              fontFamily: "inherit", opacity: submitting ? 0.55 : 0.85,
              padding: "6px 0",
            }}
          >
            {sentTo ? "Done" : "Cancel"}
          </button>
        </div>

        {/* ── Title + context ── */}
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "8px 0 6px" }}>
          Invite a friend
        </h1>
        <p style={{ fontSize: 13, opacity: 0.85, margin: "0 0 24px", lineHeight: 1.5 }}>
          They&rsquo;ll get an email with a single-use link to join <strong>{room.name}</strong>.
        </p>

        {sentTo ? (
          // ── Success state ──
          <div>
            <div style={{
              background: "rgba(255,255,255,0.95)",
              color: "var(--dos-bg, #2a4a36)",
              borderRadius: 12,
              padding: "20px 18px",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              marginBottom: 16,
            }}>
              <div style={{ flexShrink: 0, marginTop: 2 }}>
                <CheckCircle2 size={22} strokeWidth={2.2} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Invite sent</div>
                <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
                  Email is on its way to <strong>{maskEmail(sentTo)}</strong>. The link is single-use and expires in 48 hours.
                </div>
              </div>
            </div>

            <button
              onClick={() => { setSentTo(null); setEmail(""); }}
              style={{
                width: "100%",
                padding: "14px 0",
                fontSize: 16,
                fontWeight: 800,
                fontFamily: "inherit",
                background: "transparent",
                color: "#fff",
                border: "2px solid #fff",
                borderRadius: 9999,
                cursor: "pointer",
                marginBottom: 10,
              }}
            >
              Send another
            </button>
            <button
              onClick={() => navigate(`/m/rooms/${groupId}`)}
              style={{
                width: "100%",
                padding: "14px 0",
                fontSize: 16,
                fontWeight: 800,
                fontFamily: "inherit",
                background: "#fff",
                color: "var(--dos-bg)",
                border: "none",
                borderRadius: 9999,
                cursor: "pointer",
              }}
            >
              Back to room
            </button>
          </div>
        ) : (
          // ── Form ──
          <div>
            <label style={{
              display: "block",
              fontSize: 12, fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              opacity: 0.85,
              marginBottom: 6,
            }}>
              Friend&rsquo;s email
            </label>
            <div style={{ position: "relative", marginBottom: 12 }}>
              <Mail
                size={18}
                style={{
                  position: "absolute",
                  left: 14, top: "50%", transform: "translateY(-50%)",
                  opacity: 0.55,
                  pointerEvents: "none",
                }}
              />
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
                style={{
                  width: "100%",
                  padding: "14px 14px 14px 40px",
                  fontSize: 16,
                  fontFamily: "inherit",
                  border: "2px solid rgba(255,255,255,0.4)",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  outline: "none",
                  boxSizing: "border-box",
                  WebkitAppearance: "none",
                }}
              />
            </div>

            {submitError && (
              <div style={{
                marginBottom: 12,
                color: "#fff",
                background: "rgba(244,80,40,0.9)",
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
              }}>
                {submitError}
              </div>
            )}

            <button
              onClick={onSubmit}
              disabled={!canSubmit}
              style={{
                width: "100%",
                padding: "16px 0",
                fontSize: 18,
                fontWeight: 800,
                fontFamily: "inherit",
                background: canSubmit ? "#fff" : "rgba(255,255,255,0.4)",
                color: "var(--dos-bg)",
                border: "none",
                borderRadius: 9999,
                cursor: canSubmit ? "pointer" : "default",
                letterSpacing: "0.02em",
              }}
            >
              {submitting ? <LoadingDots /> : "Send invite"}
            </button>

            <p style={{
              marginTop: 16,
              fontSize: 11,
              opacity: 0.7,
              lineHeight: 1.5,
              textAlign: "center",
            }}>
              Limit: 10 invites per day. Only the room creator can send invitations.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
