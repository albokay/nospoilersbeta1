import React, { useState } from "react";
import { X } from "lucide-react";
import { CANON } from "../styles/canon";
import { preventLastWordOrphan } from "../lib/utils";
import { createPeopleGroup, createPeopleGroupInvite, sendGroupInviteEmail } from "../lib/db";

/**
 * MobileInviteSheet (CP7a) — full-screen mobile idiom of the desktop
 * dashboard's invite modal (sky card). Same flow + copy: without a
 * targetGroupId it CREATES a new people-group and mints one email invite
 * per address; with one, it invites into that existing group. The email
 * itself is best-effort (send-group-invite edge fn) — same as desktop.
 */

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const C = {
  green: CANON.personal,
  sky: CANON.friend,
  blue: CANON.identity,
  red: CANON.alert,
  cream: CANON.cream,
  midnight: CANON.dark,
};

export default function MobileInviteSheet({
  targetGroupId, onClose, onSent,
}: {
  /** Invite into this existing group; omit to create a new group. */
  targetGroupId?: string;
  onClose: () => void;
  /** Fires after invites were minted (any outcome) so the parent can refresh. */
  onSent?: () => void;
}) {
  const [emails, setEmails] = useState<string[]>([""]);
  const [fromName, setFromName] = useState("");
  const [sending, setSending] = useState(false);
  const [links, setLinks] = useState<{ email: string; link?: string; error?: string; emailFailed?: boolean }[] | null>(null);

  async function sendInvites() {
    if (sending) return;
    const list = emails.map((e) => e.trim()).filter(Boolean);
    if (!list.length) return;
    setSending(true);
    try {
      const id = targetGroupId ?? (await createPeopleGroup());
      const out: { email: string; link?: string; error?: string; emailFailed?: boolean }[] = [];
      for (const email of list) {
        try {
          const token = await createPeopleGroupInvite(id, email);
          // Await the email leg so a silent refusal surfaces as a
          // copy-the-link row instead of a false "Invites sent!".
          const sent = await sendGroupInviteEmail(token, fromName.trim() || undefined);
          out.push({ email, link: `${window.location.origin}/group-invite/${token}`, emailFailed: !sent.ok });
        } catch (e: any) {
          out.push({ email, error: e?.message === "group_full" ? "This group is full (8 max)." : (e?.message || "failed") });
        }
      }
      setLinks(out);
      onSent?.();
    } catch (e) {
      console.error("[m-invite] invites failed", e);
      setLinks([{ email: "", error: "Could not send invites." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={sheet}>
      <button style={sheetClose} onClick={onClose} aria-label="Close"><X size={20} color={C.cream} /></button>
      <div style={inner}>
        {!links ? (
          <>
            <h1 style={title}>
              {targetGroupId ? <>Connect more friends<br />to this group:</> : <>Email friends to<br />start a watch group:</>}
            </h1>
            {emails.map((email, i) => (
              <input
                key={i}
                value={email}
                onChange={(e) => setEmails((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                placeholder="email"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                className="m-invite-input"
                style={emailInput}
              />
            ))}
            <button
              onClick={() => setEmails((prev) => [...prev, ""])}
              aria-label="Add another email"
              style={plusBtn}
            >+</button>
            {/* §16 Body font (Inter regular 13); cream — desktop copy. */}
            <p style={explainer}>
              Your friend(s) will get an email invite from your username. If you don&rsquo;t think they&rsquo;d recognize it, tell them who you are:
            </p>
            <input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="hi, it's…"
              maxLength={40}
              className="m-invite-input"
              style={{ ...emailInput, marginBottom: 0 }}
            />
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <button style={{ ...sendBtn, opacity: sending ? 0.6 : 1 }} disabled={sending} onClick={sendInvites}>
                {sending ? "creating…" : "send invite"}
              </button>
            </div>
          </>
        ) : (
          <>
            {links.some((r) => r.error) && (
              <div style={{ color: C.red, fontSize: 14, fontWeight: 700, textAlign: "center", margin: "8px 0 16px" }}>
                {links.filter((r) => r.error).map((r, i) => <div key={i}>{preventLastWordOrphan(r.error ?? "")}</div>)}
              </div>
            )}
            {links.every((r) => !r.error && !r.emailFailed) && (
              <h1 style={title}>Invites sent!</h1>
            )}
            {/* Invite minted but the email leg failed — the link still
                works, so hand it to the sender (same copy as desktop). */}
            {links.some((r) => !r.error && r.emailFailed) && (
              <>
                <p style={{ fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, lineHeight: 1.5, color: C.cream, margin: "8px 0 12px" }}>
                  {preventLastWordOrphan(links.filter((r) => !r.error && r.emailFailed).length === 1
                    ? "Sidebar is having an issue and couldn't email this invite right now. You can copy the link and send it to your friend yourself. It works the same. Or log out, log back in, and try one more time. Sorry for the inconvenience."
                    : "Sidebar is having an issue and couldn't email these invites right now. You can copy the links and send them to your friends yourself. They work the same. Or log out, log back in, and try one more time. Sorry for the inconvenience.")}
                </p>
                {links.filter((r) => !r.error && r.emailFailed).map((r, i) => (
                  <CopyLinkRow key={i} email={r.email} link={r.link ?? ""} />
                ))}
              </>
            )}
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button style={sendBtn} onClick={onClose}>done</button>
            </div>
          </>
        )}
      </div>
      {/* Cream placeholders on the sky sheet (the shared .m-input rule is
          scoped to green surfaces; these inputs are cream-filled). */}
      <style>{`.m-invite-input::placeholder { color: rgba(26,58,74,0.45); }`}</style>
    </div>
  );
}

// Copyable invite-link row (mobile twin of the dashboard's CopyRow — raw
// text is too easy to mis-transcribe).
function CopyLinkRow({ email, link }: { email: string; link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ background: C.cream, borderRadius: 12, padding: 12, marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.midnight }}>{email || "—"}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.blue, wordBreak: "break-all", flex: 1, textDecoration: "none" }}>{link}</a>
        <button
          onClick={() => { try { navigator.clipboard?.writeText(link); } catch { /* ignore */ } setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          style={{ border: "none", background: C.blue, color: C.cream, fontSize: 11, fontWeight: 700, padding: "8px 14px", borderRadius: 65, cursor: "pointer", whiteSpace: "nowrap", minHeight: 32 }}
        >{copied ? "copied!" : "copy"}</button>
      </div>
    </div>
  );
}

const sheet: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, overflowY: "auto",
  WebkitOverflowScrolling: "touch", background: C.sky,
  paddingTop: "calc(env(safe-area-inset-top, 0px) + 64px)",
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)",
  boxSizing: "border-box",
};
const sheetClose: React.CSSProperties = {
  position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 12px)", right: 12,
  width: 44, height: 44, border: "none", background: "transparent", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center", zIndex: 1001,
};
const inner: React.CSSProperties = { maxWidth: 420, margin: "0 auto", padding: "0 20px" };
const title: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 26, letterSpacing: 0, color: C.cream,
  textAlign: "center", margin: "8px 0 24px",
};
const emailInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "none", borderRadius: 65,
  padding: "14px 24px", fontFamily: '"Inter", sans-serif', fontSize: 16,
  color: C.midnight, background: C.cream, outline: "none", marginBottom: 10,
  minHeight: 44,
};
const plusBtn: React.CSSProperties = {
  width: 44, height: 44, borderRadius: "50%", border: "none", background: C.cream,
  color: C.midnight, fontSize: 22, cursor: "pointer", marginTop: 2,
};
const explainer: React.CSSProperties = {
  fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, letterSpacing: "normal",
  lineHeight: 1.5, color: C.cream, margin: "28px 0 12px",
};
const sendBtn: React.CSSProperties = {
  border: "none", background: C.blue, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "14px 40px", borderRadius: 65, cursor: "pointer", minHeight: 44,
  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};
