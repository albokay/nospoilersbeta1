import React, { useState } from "react";
import Modal from "./Modal";
import LoadingDots from "./LoadingDots";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import { deleteAccount } from "../lib/db";
import { CANON } from "../styles/canon";

// Minimal account surface. Currently houses the self-serve "delete account"
// flow (ANONYMIZE model): personal info + private notes are erased, shared-room
// posts are kept but shown as "[deleted]". Two-step, type-to-confirm guard
// because the action is permanent and irreversible.
const C = { red: CANON.red, cream: CANON.cream, midnight: CANON.midnight, greyblue: CANON.greyblue };

export default function AccountModal({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth() as any;
  const [phase, setPhase] = useState<"main" | "confirm">("main");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmText.trim().toUpperCase() === "DELETE";

  async function doDelete() {
    setBusy(true);
    setError(null);
    const res = await deleteAccount();
    if (!res.ok) {
      setBusy(false);
      setError(res.message || "Something went wrong. Please try again.");
      return;
    }
    // Success — the account is now scrubbed + banned server-side. Clear the
    // local session (local scope: fast, no network call that could hang on the
    // banned user) and HARD-reload to the homepage. A soft navigate would fire
    // while the app still holds the user in memory and bounce back to
    // /dashboard; a full reload re-initializes with no session -> narrative
    // homepage, signalling the account is truly gone.
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
    window.location.replace("/");
  }

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <h3 style={{ margin: "0 0 16px", fontSize: 20, color: C.midnight, fontWeight: 700 }}>Account</h3>
      {profile?.username && (
        <p style={{ margin: "0 0 20px", fontSize: 14, color: C.midnight }}>
          Signed in as <strong>@{profile.username}</strong>
        </p>
      )}

      {phase === "main" && (
        <div style={{ borderTop: `1px solid ${C.greyblue}`, paddingTop: 16 }}>
          <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 700, color: C.red }}>Delete account</p>
          <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.55, color: C.midnight }}>
            Permanently deletes your account and personal info, and erases your private notes.
            Your posts in shared rooms stay so your friends’ conversations aren’t broken — but they’ll
            show as “[deleted]” and you’ll disappear from every room, map, and chat. This can’t be undone.
          </p>
          <button onClick={() => setPhase("confirm")} style={dangerOutline}>Delete my account</button>
        </div>
      )}

      {phase === "confirm" && (
        <div style={{ borderTop: `1px solid ${C.greyblue}`, paddingTop: 16 }}>
          <p style={{ margin: "0 0 12px", fontSize: 14, color: C.midnight, lineHeight: 1.5 }}>
            This is permanent. Type <strong>DELETE</strong> to confirm.
          </p>
          <input
            value={confirmText}
            onChange={(e) => { setConfirmText(e.target.value); setError(null); }}
            placeholder="DELETE"
            autoFocus
            disabled={busy}
            autoComplete="off"
            style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 8, border: `2px solid ${C.greyblue}`, fontSize: 14, color: C.midnight, boxSizing: "border-box", marginBottom: 12 }}
          />
          {error && <p style={{ margin: "0 0 12px", fontSize: 13, color: C.red, fontWeight: 600 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => { setPhase("main"); setConfirmText(""); setError(null); }} disabled={busy} style={cancelBtn}>Cancel</button>
            <button
              onClick={doDelete}
              disabled={busy || !canDelete}
              style={{ ...dangerSolid, opacity: (busy || !canDelete) ? 0.5 : 1, cursor: (busy || !canDelete) ? "not-allowed" : "pointer" }}
            >
              {busy ? <LoadingDots /> : "Permanently delete"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const dangerOutline: React.CSSProperties = { padding: "10px 18px", borderRadius: 999, border: `2px solid ${C.red}`, background: "transparent", color: C.red, fontSize: 14, fontWeight: 700, cursor: "pointer" };
const dangerSolid: React.CSSProperties = { padding: "10px 18px", borderRadius: 999, border: "none", background: C.red, color: "#FEF8EA", fontSize: 14, fontWeight: 700 };
const cancelBtn: React.CSSProperties = { padding: "10px 18px", borderRadius: 999, border: `2px solid ${C.greyblue}`, background: "transparent", color: C.midnight, fontSize: 14, fontWeight: 700, cursor: "pointer" };
