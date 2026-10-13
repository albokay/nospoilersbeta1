import React, { useState } from "react";
import { X, LogOut } from "lucide-react";
import Modal from "./Modal";
import LoadingDots from "./LoadingDots";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import { deleteAccount, setOwnDisplayName, setOwnSkin, adminSetSiteSkin, type ProfileSkin } from "../lib/db";
import { CANON } from "../styles/canon";
import { M, OVERLAY, LORA } from "../mobile/m";
import { D } from "./dashboardChrome";
import useSheetSwipeDown from "../lib/useSheetSwipeDown";
import { useEditorial, useSiteSkin, setSiteSkinLocal } from "../lib/skin";
import { E } from "../styles/editorial";
import { SectionHead } from "./editorial/Chrome";
import { AnswerRow, EditorialDialog } from "./editorial/GroupRoom";
import { BottomSheet } from "./editorial/Overlays";
import { Field, Block, Frame, FORM_CSS } from "./editorial/Onboarding";

// Minimal account surface. Currently houses the self-serve "delete account"
// flow (ANONYMIZE model): personal info + private notes are erased, shared-room
// posts are kept but shown as "[deleted]". Two-step, type-to-confirm guard
// because the action is permanent and irreversible.
const C = { red: CANON.alert, cream: CANON.cream, midnight: CANON.dark, greyblue: CANON.business };
// The two looks (the editorial skin's switch, checkpoint 1 2026-10-10).
const SKIN_CHOICES: [ProfileSkin, string][] = [["classic", "Classic"], ["editorial", "Editorial"]];

// onSignOut (opt-in; mobile polish 2026-09-14): when passed, a "Signed in"
// section with a Sign out button renders — LAST, after the delete section
// (Alborz 2026-09-27; it sat between the name and delete). Every caller
// passes it now (/m dashboard, desktop dashboard + show room).
// mobile (Part-2 overlay 9): renders the /m idiom instead of the desktop
// Modal — a cream bottom sheet (grabber + swipe + tap-out), with the
// type-DELETE step as a centered cream DIALOG (Cancel is the exit; it's one
// of the two truly irreversible confirms on /m). Desktop path byte-identical.
export default function AccountModal({ onClose, onSignOut, mobile }: { onClose: () => void; onSignOut?: () => void | Promise<void>; mobile?: boolean }) {
  const { user, profile, refreshProfile } = useAuth() as any;
  const editorial = useEditorial();
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

  // Look (the editorial skin's switch, checkpoint 1 2026-10-10; admin-only
  // since 2026-10-13): the admin's own look, for comparing — and below it
  // the site's look, which every other account follows. Everyone else never
  // sees the section.
  const currentSkin: ProfileSkin = profile?.skin === "editorial" ? "editorial" : "classic";
  const canPickSkin = !!profile && !!profile.is_admin;
  const [skinSaving, setSkinSaving] = useState(false);
  const siteSkin = useSiteSkin();
  const [siteSaving, setSiteSaving] = useState(false);
  async function chooseSiteSkin(next: ProfileSkin) {
    if (!profile?.is_admin || siteSaving || next === (siteSkin ?? "classic")) return;
    setSiteSaving(true);
    try {
      await adminSetSiteSkin(next);
      setSiteSkinLocal(next);
    } catch (err) {
      console.error("[account] adminSetSiteSkin failed:", err);
    } finally {
      setSiteSaving(false);
    }
  }
  async function chooseSkin(next: ProfileSkin) {
    if (!user?.id || next === currentSkin || skinSaving) return;
    setSkinSaving(true);
    try {
      await setOwnSkin(user.id, next);
      await refreshProfile?.();
    } catch (err) {
      console.error("[account] setOwnSkin failed:", err);
    } finally {
      setSkinSaving(false);
    }
  }

  // Mobile sheet swipe-down (hook must run unconditionally; inert on desktop).
  const sheetSwipe = useSheetSwipeDown(onClose, { enabled: mobile && !busy && phase === "main", open: mobile });

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

  // The editorial card (Alborz's notes, item 7): "Account" in Lora with the
  // email in mono, each section on a rule — the name as a field with Save,
  // Look as the answer row, Delete in alert, Sign out as a frame; the
  // type-DELETE step as the same frame. The dialog on desktop, the sheet on
  // the phone. Same saves, same delete.
  if (editorial) {
    const note: React.CSSProperties = { ...E.type.note13, color: E.color.inkSub, marginTop: 10 };
    const err: React.CSSProperties = { ...E.type.note13, color: E.color.alert, fontWeight: 600, marginTop: 10 };
    const main = (
      <>
        <div style={E.type.letterTitle22}>Account</div>
        {user?.email && <div style={{ ...E.type.label11, color: E.color.inkSub, marginTop: 6 }}>{user.email}</div>}
        {/* Sign out first (Alborz's notes, round 5). */}
        {onSignOut && (
          <>
            <SectionHead style={{ marginTop: 28 }}>Signed in</SectionHead>
            <Frame onClick={() => { void onSignOut(); }} style={{ marginTop: 14, height: 48, ...E.type.label11 }}><LogOut size={14} /> Sign out</Frame>
          </>
        )}
        <SectionHead style={{ marginTop: 28 }}>Your name</SectionHead>
        <div style={note}>How you show up for your friends, unless they&rsquo;ve saved their own name for you.</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14 }}>
          <Field label="Name" value={nameDraft} onChange={(v) => { setNameDraft(v); setNameError(null); }} placeholder="" maxLength={40} autoComplete="given-name" readOnly={nameSaving} style={{ flex: 1, minWidth: 0 }} />
          <Block onClick={saveName} disabled={nameSaving || !nameDirty} style={{ width: "auto", height: 44, padding: "0 18px", ...E.type.label11, flexShrink: 0 }}>{nameSaving ? <LoadingDots /> : nameSaved ? "Saved" : "Save"}</Block>
        </div>
        {nameError && <div style={err}>{nameError}</div>}
        {canPickSkin && (
          <>
            <SectionHead style={{ marginTop: 28 }}>Your look</SectionHead>
            <div style={note}>Your own account, for comparing. Everyone else follows the site&rsquo;s look below.</div>
            <AnswerRow label="Your look" options={[{ value: "classic", label: "Classic" }, { value: "editorial", label: "Editorial" }]} value={currentSkin} onChange={(v) => { void chooseSkin(v as ProfileSkin); }} />
            <SectionHead style={{ marginTop: 28 }}>Everyone&rsquo;s look</SectionHead>
            <div style={note}>The look every account and the signed-out pages follow. Others see it on their next page load.{siteSaving ? " Saving…" : ""}</div>
            <AnswerRow label="Everyone's look" options={[{ value: "classic", label: "Classic" }, { value: "editorial", label: "Editorial" }]} value={siteSkin ?? "classic"} onChange={(v) => { void chooseSiteSkin(v as ProfileSkin); }} />
          </>
        )}
        <SectionHead style={{ marginTop: 28, color: E.color.alert, borderBottomColor: E.color.alert }}>Delete account</SectionHead>
        <div style={note}>Permanently deletes your account, personal info and private notes. Posts in shared rooms stay, shown as &ldquo;(deleted user)&rdquo;. This can&rsquo;t be undone.</div>
        <Frame onClick={() => setPhase("confirm")} style={{ marginTop: 14, height: 48, ...E.type.label11, color: E.color.alert, borderColor: E.color.alert }}>Delete my account…</Frame>
      </>
    );
    const confirm = (
      <>
        <div style={E.type.letterTitle22}>Delete your account?</div>
        <div style={note}>This is permanent. Type <strong>DELETE</strong> to confirm.</div>
        <Field label="Type DELETE" value={confirmText} onChange={(v) => { setConfirmText(v); setError(null); }} placeholder="DELETE" autoFocus readOnly={busy} autoComplete="off" style={{ marginTop: 18 }} />
        {error && <div style={err}>{error}</div>}
        <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
          <button type="button" onClick={doDelete} disabled={busy || !canDelete} style={{ ...E.type.button16, flex: 1, height: 54, border: 0, background: E.color.alert, color: E.color.cream, cursor: busy || !canDelete ? "not-allowed" : "pointer", opacity: busy || !canDelete ? 0.6 : 1 }}>{busy ? <LoadingDots /> : "Permanently delete"}</button>
          <button type="button" onClick={() => { setPhase("main"); setConfirmText(""); setError(null); }} disabled={busy} style={{ ...E.type.button16, flex: 1, height: 54, border: `1px solid ${E.color.ink}`, background: "transparent", color: E.color.ink, cursor: "pointer", boxSizing: "border-box" }}>Cancel</button>
        </div>
      </>
    );
    const body = <><style>{FORM_CSS}</style>{phase === "confirm" ? confirm : main}</>;
    return mobile
      ? <BottomSheet onClose={() => { if (!busy) onClose(); }} zIndex={phase === "confirm" ? 1300 : 1000} label="Account">{body}</BottomSheet>
      : <EditorialDialog onClose={() => { if (!busy) onClose(); }} width={480} label="Account" align="left">{body}</EditorialDialog>;
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

          {canPickSkin && (
            <>
              <div style={mDivider} />
              <div style={mLabel}>Look</div>
              <div style={{ ...mCaption, marginBottom: 12 }}>The editorial look is being built page by page. Switch back any time.</div>
              <div style={{ display: "flex", gap: 10 }}>
                {SKIN_CHOICES.map(([s, name]) => (
                  <button
                    key={s}
                    onClick={() => { void chooseSkin(s); }}
                    disabled={skinSaving}
                    style={{ ...M.pill.M, flex: 1, ...(currentSkin === s ? { background: C.midnight, color: CANON.cream } : { background: "transparent", color: C.midnight, border: `2px solid ${C.midnight}` }), opacity: skinSaving ? M.disabledOpacity : 1 }}
                  >
                    {name}
                  </button>
                ))}
              </div>
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

          {onSignOut && (
            <>
              <div style={mDivider} />
              <div style={{ ...mLabel, marginBottom: 12 }}>Signed in</div>
              <button onClick={() => { void onSignOut(); }} style={signOutBtn}>
                <LogOut size={16} /> Sign out
              </button>
            </>
          )}
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

      {phase === "main" && canPickSkin && (
        <div>
          <div style={D.divider(C.midnight)} />
          <p style={{ ...D.type.label, margin: "0 0 6px", color: C.midnight }}>Look</p>
          <p style={{ ...D.type.caption, margin: "0 0 14px", color: C.midnight, opacity: 0.7 }}>
            The editorial look is being built page by page. Switch back any time.
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            {SKIN_CHOICES.map(([s, name]) => (
              <button
                key={s}
                onClick={() => { void chooseSkin(s); }}
                disabled={skinSaving}
                style={{ ...D.pill.M, flex: 1, ...(currentSkin === s ? { background: C.midnight, color: CANON.cream } : { background: "transparent", color: C.midnight, border: `2px solid ${C.midnight}` }), opacity: skinSaving ? D.disabledOpacity : 1, cursor: skinSaving ? "default" : "pointer" }}
              >
                {name}
              </button>
            ))}
          </div>
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

      {phase === "main" && onSignOut && (
        <div>
          <div style={D.divider(C.midnight)} />
          <p style={{ ...D.type.label, margin: "0 0 12px", color: C.midnight }}>Signed in</p>
          <button onClick={() => { void onSignOut(); }} style={signOutBtn}>
            <LogOut size={16} /> Sign out
          </button>
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
