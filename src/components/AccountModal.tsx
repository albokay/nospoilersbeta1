import React, { useState } from "react";
import Modal from "./Modal";
import LoadingDots from "./LoadingDots";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import { deleteAccount, setOwnDisplayName } from "../lib/db";
import { CANON } from "../styles/canon";

// Minimal account surface. Currently houses the self-serve "delete account"
// flow (ANONYMIZE model): personal info + private notes are erased, shared-room
// posts are kept but shown as "[deleted]". Two-step, type-to-confirm guard
// because the action is permanent and irreversible.
const C = { red: CANON.alert, cream: CANON.cream, midnight: CANON.dark, greyblue: CANON.business };

export default function AccountModal({ onClose }: { onClose: () => void }) {
  const { user, profile, refreshProfile } = useAuth() as any;
  const [phase, setPhase] = useState<"main" | "confirm">("main");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Your name" (first-name identity CP4): edits profiles.display_name — how
  // the user appears everywhere. Prefilled with the current name; required
  // (blank can't save, so the internal handle never resurfaces as a name).
  const [nameDraft, setNameDraft] = useState<string>(profile?.display_name ?? "");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameDirty = nameDraft.trim() !== (profile?.display_name ?? "") && nameDraft.trim().length > 0;

  async function saveName() {
    if (!user?.id || !nameDirty || nameSaving) return;
    setNameSaving(true);
    setNameError(null);
    try {
      await setOwnDisplayName(user.id, nameDraft);
      await refreshProfile();
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2500);
    } catch {
      setNameError("Couldn't save your name. Please try again.");
    } finally {
      setNameSaving(false);
    }
  }

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
    // Belt-and-suspenders: the anonymize model keeps a still-valid access token
    // (the ban only blocks NEW logins) until it expires. If signOut didn't
    // clear storage, the hard reload below would restore that session and show
    // the now-"deleted_…" profile. Force-remove any persisted Supabase auth
    // token so "/" loads fully signed-out → the narrative homepage.
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-") && k.includes("-auth-token")) localStorage.removeItem(k);
      }
    } catch { /* ignore */ }
    window.location.replace("/");
  }

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <h3 style={{ margin: "0 0 16px", fontSize: 20, color: C.midnight, fontWeight: 700 }}>Account</h3>
      {user?.email && (
        <p style={{ margin: "0 0 20px", fontSize: 14, color: C.midnight }}>
          Signed in as <strong>{user.email}</strong>
        </p>
      )}

      {phase === "main" && (
        <div style={{ borderTop: `1px solid ${C.cream}`, paddingTop: 16, marginBottom: 20 }}>
          <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 700, color: C.midnight }}>Your name</p>
          <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.55, color: C.midnight }}>
            This is how you show up for your friends (unless they&rsquo;ve saved their own name for you).
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              value={nameDraft}
              onChange={(e) => { setNameDraft(e.target.value); setNameError(null); }}
              placeholder="your first name"
              maxLength={40}
              disabled={nameSaving}
              autoComplete="given-name"
              style={{ flex: 1, height: 40, padding: "0 12px", borderRadius: 8, border: `2px solid ${C.greyblue}`, fontSize: 14, color: C.midnight, boxSizing: "border-box" }}
            />
            <button
              onClick={saveName}
              disabled={nameSaving || !nameDirty}
              style={{ ...saveBtn, opacity: nameSaving || !nameDirty ? 0.5 : 1, cursor: nameSaving || !nameDirty ? "default" : "pointer" }}
            >
              {nameSaving ? <LoadingDots /> : nameSaved ? "saved!" : "save"}
            </button>
          </div>
          {nameError && <p style={{ margin: "10px 0 0", fontSize: 13, color: C.red, fontWeight: 600 }}>{nameError}</p>}
        </div>
      )}

      {phase === "main" && (
        <div style={{ borderTop: `1px solid ${C.cream}`, paddingTop: 16 }}>
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
        <div style={{ borderTop: `1px solid ${C.cream}`, paddingTop: 16 }}>
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
const dangerSolid: React.CSSProperties = { padding: "10px 18px", borderRadius: 999, border: "none", background: C.red, color: CANON.cream, fontSize: 14, fontWeight: 700 };
const cancelBtn: React.CSSProperties = { padding: "10px 18px", borderRadius: 999, border: `2px solid ${C.cream}`, background: "transparent", color: C.cream, fontSize: 14, fontWeight: 700, cursor: "pointer" };
const saveBtn: React.CSSProperties = { padding: "10px 18px", borderRadius: 999, border: "none", background: C.midnight, color: CANON.cream, fontSize: 14, fontWeight: 700, flexShrink: 0 };
