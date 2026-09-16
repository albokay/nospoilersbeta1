import React, { useState } from "react";
import { X, LogOut } from "lucide-react";
import Modal from "./Modal";
import LoadingDots from "./LoadingDots";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import { deleteAccount, setOwnDisplayName } from "../lib/db";
import { CANON } from "../styles/canon";
import { M, OVERLAY, LORA } from "../mobile/m";
import { D } from "./dashboardChrome";
import useSheetSwipeDown from "../lib/useSheetSwipeDown";

// Minimal account surface. Currently houses the self-serve "delete account"
// flow (ANONYMIZE model): personal info + private notes are erased, shared-room
// posts are kept but shown as "[deleted]". Two-step, type-to-confirm guard
// because the action is permanent and irreversible.
const C = { red: CANON.alert, cream: CANON.cream, midnight: CANON.dark, greyblue: CANON.business };

// onSignOut (opt-in; mobile polish 2026-09-14): when passed, a "Signed in"
// section with a Sign out button renders between the name and delete
// sections — /m's dashboard dropped its sign-out circle and routes the
// action here. Desktop callers pass nothing and are unchanged.
// mobile (Part-2 overlay 9): renders the /m idiom instead of the desktop
// Modal — a cream bottom sheet (grabber + swipe + tap-out), with the
// type-DELETE step as a centered cream DIALOG (Cancel is the exit; it's one
// of the two truly irreversible confirms on /m). Desktop path byte-identical.
export default function AccountModal({ onClose, onSignOut, mobile }: { onClose: () => void; onSignOut?: () => void | Promise<void>; mobile?: boolean }) {
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

  // Mobile sheet swipe-down (hook must run unconditionally; inert on desktop).
  const sheetSwipe = useSheetSwipeDown(onClose, { enabled: mobile && !busy && phase === "main" });

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

  if (mobile) {
    // ── /m idiom (polish pass 2026-09-14) ──────────────────────────────────
    if (phase === "confirm") {
      return (
        <div style={{ ...OVERLAY.dialogWrap, zIndex: 1300 }}>
          <div style={{ ...OVERLAY.dialog, background: CANON.cream }}>
            <p style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.5, color: C.midnight }}>
              This is permanent. Type <strong>DELETE</strong> to confirm.
            </p>
            <input
              value={confirmText}
              onChange={(e) => { setConfirmText(e.target.value); setError(null); }}
              placeholder="DELETE"
              autoFocus
              disabled={busy}
              autoComplete="off"
              style={{ ...M.input, boxShadow: `inset 0 0 0 2px ${CANON.friend}`, marginBottom: 12 }}
            />
            {error && <p style={{ margin: "0 0 12px", fontSize: 14, color: C.red, fontWeight: 600 }}>{error}</p>}
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={doDelete}
                disabled={busy || !canDelete}
                style={{ ...M.pill.M, flex: 1, background: C.red, color: CANON.cream, whiteSpace: "nowrap", opacity: (busy || !canDelete) ? M.disabledOpacity : 1 }}
              >
                {busy ? <LoadingDots /> : "Permanently delete"}
              </button>
              <button
                onClick={() => { setPhase("main"); setConfirmText(""); setError(null); }}
                disabled={busy}
                style={{ ...M.pill.M, flex: 1, background: "transparent", color: C.midnight, border: `2px solid ${C.midnight}` }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div
        style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(26,58,74,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "mDimIn 180ms ease-out" }}
        onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      >
        <div {...sheetSwipe.handlers} style={{ ...OVERLAY.sheet, background: CANON.cream, ...sheetSwipe.style }}>
          <div style={OVERLAY.grabber(C.midnight)} />
          <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, lineHeight: 1.25, color: C.midnight }}>Account</div>
          {user?.email && <div style={{ ...mCaption, marginTop: 2 }}>{user.email}</div>}

          <div style={{ ...mLabel, marginTop: 20 }}>Your name</div>
          <div style={{ ...mCaption, marginBottom: 12 }}>
            How you show up for your friends, unless they&rsquo;ve saved their own name for you.
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              value={nameDraft}
              onChange={(e) => { setNameDraft(e.target.value); setNameError(null); }}
              placeholder="your first name"
              maxLength={40}
              disabled={nameSaving}
              autoComplete="given-name"
              style={{ ...M.input, flex: 1, width: "auto", boxShadow: `inset 0 0 0 2px ${CANON.friend}` }}
            />
            <button
              onClick={saveName}
              disabled={nameSaving || !nameDirty}
              style={{ ...M.pill.M, flexShrink: 0, background: CANON.identity, color: CANON.cream, opacity: nameSaving || !nameDirty ? M.disabledOpacity : 1 }}
            >
              {nameSaving ? <LoadingDots /> : nameSaved ? "Saved!" : "Save"}
            </button>
          </div>
          {nameError && <p style={{ margin: "10px 0 0", fontSize: 14, color: C.red, fontWeight: 600 }}>{nameError}</p>}

          {onSignOut && (
            <>
              <div style={mDivider} />
              <div style={{ ...mLabel, marginBottom: 12 }}>Signed in</div>
              <button onClick={() => { void onSignOut(); }} style={signOutBtn}>
                <LogOut size={16} /> Sign out
              </button>
            </>
          )}

          <div style={mDivider} />
          <div style={{ ...mLabel, color: C.red }}>Delete account</div>
          <div style={{ ...mCaption, marginBottom: 12 }}>
            Permanently deletes your account, personal info and private notes. Posts in shared rooms
            stay, shown as &ldquo;(deleted user)&rdquo;. This can&rsquo;t be undone.
          </div>
          <button onClick={() => setPhase("confirm")} style={{ ...M.pill.M, background: "transparent", color: C.red, border: `2px solid ${C.red}` }}>
            Delete my account&hellip;
          </button>
        </div>
      </div>
    );
  }

  return (
    <Modal
      onClose={busy ? () => {} : onClose}
      width={phase === "confirm" ? "min(360px, 92vw)" : undefined}
      cardStyle={{ ...(phase === "confirm" ? D.card.dialog : D.card.form), background: CANON.cream, color: C.midnight }}
    >
      {/* "×" close (Alborz 2026-08-12) — in addition to tap-outside; same
          busy guard so a mid-flight save/delete can't be interrupted. Hidden
          on the type-DELETE dialog (Cancel is the exit). */}
      {phase === "main" && (
        <button
          aria-label="close"
          onClick={busy ? undefined : onClose}
          style={{ ...D.closeX, color: C.midnight, opacity: 0.6 }}
        >
          <X size={20} />
        </button>
      )}
      {phase === "main" && (
        <>
          <h3 style={{ ...D.type.title, margin: 0, color: C.midnight }}>Account</h3>
          {user?.email && (
            <p style={{ ...D.type.caption, margin: "2px 0 0", color: C.midnight, opacity: 0.7 }}>
              {user.email}
            </p>
          )}
          <div style={{ height: 20 }} />
        </>
      )}

      {phase === "main" && (
        <div>
          <p style={{ ...D.type.label, margin: "0 0 6px", color: C.midnight }}>Your name</p>
          <p style={{ ...D.type.caption, margin: "0 0 12px", color: C.midnight, opacity: 0.7 }}>
            How you show up for your friends, unless they&rsquo;ve saved their own name for you.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <input
              value={nameDraft}
              onChange={(e) => { setNameDraft(e.target.value); setNameError(null); }}
              placeholder="your first name"
              maxLength={40}
              disabled={nameSaving}
              autoComplete="given-name"
              style={{ ...D.input, ...D.inputOnCream, flex: 1, width: "auto" }}
            />
            <button
              onClick={saveName}
              disabled={nameSaving || !nameDirty}
              style={{ ...D.pill.M, flexShrink: 0, background: CANON.identity, color: CANON.cream, opacity: nameSaving || !nameDirty ? D.disabledOpacity : 1, cursor: nameSaving || !nameDirty ? "default" : "pointer" }}
            >
              {nameSaving ? <LoadingDots /> : nameSaved ? "Saved!" : "Save"}
            </button>
          </div>
          {nameError && <p style={{ margin: "10px 0 0", fontSize: 14, color: C.red, fontWeight: 600 }}>{nameError}</p>}
        </div>
      )}

      {phase === "main" && onSignOut && (
        <div>
          <div style={D.divider(C.midnight)} />
          <p style={{ ...D.type.label, margin: "0 0 12px", color: C.midnight }}>Signed in</p>
          <button onClick={() => { void onSignOut(); }} style={signOutBtn}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}

      {phase === "main" && (
        <div>
          <div style={D.divider(C.midnight)} />
          <p style={{ ...D.type.label, margin: "0 0 6px", color: C.red }}>Delete account</p>
          <p style={{ ...D.type.caption, margin: "0 0 14px", color: C.midnight, opacity: 0.7 }}>
            Permanently deletes your account, personal info and private notes. Posts in shared rooms
            stay, shown as &ldquo;(deleted user)&rdquo;. This can&rsquo;t be undone.
          </p>
          <button onClick={() => setPhase("confirm")} style={dangerOutline}>Delete my account&hellip;</button>
        </div>
      )}

      {phase === "confirm" && (
        <div>
          <p style={{ margin: "0 0 12px", fontSize: 15, color: C.midnight, lineHeight: 1.5 }}>
            This is permanent. Type <strong>DELETE</strong> to confirm.
          </p>
          <input
            value={confirmText}
            onChange={(e) => { setConfirmText(e.target.value); setError(null); }}
            placeholder="DELETE"
            autoFocus
            disabled={busy}
            autoComplete="off"
            style={{ ...D.input, ...D.inputOnCream, marginBottom: 12 }}
          />
          {error && <p style={{ margin: "0 0 12px", fontSize: 14, color: C.red, fontWeight: 600 }}>{error}</p>}
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={doDelete}
              disabled={busy || !canDelete}
              style={{ ...D.pill.M, flex: 1, background: C.red, color: CANON.cream, whiteSpace: "nowrap", opacity: (busy || !canDelete) ? D.disabledOpacity : 1, cursor: (busy || !canDelete) ? "not-allowed" : "pointer" }}
            >
              {busy ? <LoadingDots /> : "Permanently delete"}
            </button>
            <button onClick={() => { setPhase("main"); setConfirmText(""); setError(null); }} disabled={busy} style={{ ...D.pill.M, flex: 1, background: "transparent", color: C.midnight, border: `2px solid ${C.midnight}` }}>Cancel</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const dangerOutline: React.CSSProperties = { ...D.pill.M, border: `2px solid ${C.red}`, background: "transparent", color: C.red };
// M-size dark-outline pill (the mobile polish's overlay grammar) — the same
// shape the Part-2 account sheet keeps, so this row won't need a restyle.
const signOutBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "12px 28px", minHeight: 44, borderRadius: 999, boxSizing: "border-box",
  border: `2px solid ${C.midnight}`, background: "transparent", color: C.midnight,
  fontSize: 14, fontWeight: 700, cursor: "pointer",
};
// /m sheet grammar (polish pass 2026-09-14).
const mLabel: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, color: C.midnight, marginBottom: 8,
};
const mCaption: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif', fontWeight: 400, fontSize: 13, lineHeight: 1.45, color: C.midnight, opacity: 0.7,
};
const mDivider: React.CSSProperties = { height: 1, background: "rgba(26,58,74,0.12)", margin: "24px 0" };
