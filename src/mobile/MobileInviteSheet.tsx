import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { CANON } from "../styles/canon";
import { useAuth } from "../lib/auth";
import { preventLastWordOrphan } from "../lib/utils";
import {
  createPeopleGroup,
  createPeopleGroupInvite,
  sendGroupInviteEmail,
  setShowVote,
  ensureProgressRow,
  fetchShows,
  fetchProgress,
  createShow,
  type Show,
} from "../lib/db";
import { tvmazeSearch, tvmazeEpisodes, networkLabel, slugify, type TVmazeShow } from "../lib/tvmaze";
import type { ProgressEntry } from "../types";

/**
 * MobileInviteSheet — full-screen mobile idiom of the desktop dashboard's
 * invite modal (sky card). Same flow + copy (CP2 groups-only model,
 * 2026-07-06): without a targetGroupId it CREATES a new group as ONE act —
 * at least one NAMED friend (name + email both required per filled row) AND
 * at least one proposed show (in-sheet picker: catalog + TVMaze add; chips
 * with ×) — proposing each show (vote + quiet S0E0 row) and minting one
 * email invite per address, the typed name riding each invite (it becomes
 * the sender's contact name for them on accept). With a targetGroupId it
 * invites into that existing group (names optional there, same as desktop).
 * The email leg surfaces failures as copy-the-link rows — never a false
 * "Invites sent!".
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
  targetGroupId, onClose, onSent, onCreated,
}: {
  /** Invite into this existing group; omit to create a new group. */
  targetGroupId?: string;
  onClose: () => void;
  /** Fires after invites were minted (any outcome) so the parent can refresh. */
  onSent?: () => void;
  /** Fires INSTEAD of onClose when the sheet closes after creating a group —
   *  the parent lands the user inside it (desktop parity: done/× after a
   *  create navigates into the new group). */
  onCreated?: (groupId: string) => void;
}) {
  const { user } = useAuth();
  const creating = !targetGroupId;

  const [rows, setRows] = useState<{ name: string; email: string }[]>([{ name: "", email: "" }]);
  const [sending, setSending] = useState(false);
  const [links, setLinks] = useState<{ email: string; link?: string; error?: string; emailFailed?: boolean }[] | null>(null);
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null);

  // Create-mode show picker (desktop's in-modal picker: catalog + TVMaze).
  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [inviteShows, setInviteShows] = useState<Show[]>([]);
  const [showQuery, setShowQuery] = useState("");
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [creatingShow, setCreatingShow] = useState(false);
  const tvDebounceRef = useRef<number | null>(null);

  // Catalog + the viewer's progress rows — create mode only (the picker and
  // the propose legs need them). Tolerant: a miss just narrows the picker to
  // TVMaze adds.
  useEffect(() => {
    if (!creating || !user) return;
    let cancelled = false;
    fetchShows().then((s) => { if (!cancelled) setShows(s); }).catch(() => {});
    fetchProgress(user.id).then((p) => { if (!cancelled) setProgress(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [creating, user]);

  const catalogMatches = useMemo(() => {
    const q = showQuery.trim().toLowerCase();
    if (!q) return [];
    const sel = new Set(inviteShows.map((s) => s.id));
    return shows.filter((s) => !s.isHidden && !sel.has(s.id) && s.name.toLowerCase().includes(q)).slice(0, 5);
  }, [showQuery, shows, inviteShows]);

  useEffect(() => {
    if (!creating) { setTvResults([]); return; }
    const q = showQuery.trim();
    if (q.length < 2) { setTvResults([]); return; }
    if (tvDebounceRef.current) window.clearTimeout(tvDebounceRef.current);
    let cancelled = false;
    tvDebounceRef.current = window.setTimeout(async () => {
      try {
        const r = await tvmazeSearch(q);
        if (!cancelled) setTvResults(r);
      } catch { if (!cancelled) setTvResults([]); }
    }, 320);
    return () => { cancelled = true; if (tvDebounceRef.current) window.clearTimeout(tvDebounceRef.current); };
  }, [showQuery, creating]);

  const tvToAdd = useMemo(() => {
    const known = new Set(shows.map((s) => s.id));
    const sel = new Set(inviteShows.map((s) => s.id));
    const seen = new Set<string>();
    const out: { tv: TVmazeShow; id: string }[] = [];
    for (const tv of tvResults) {
      const id = slugify(tv.name);
      if (known.has(id) || sel.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ tv, id });
      if (out.length >= 5) break;
    }
    return out;
  }, [tvResults, shows, inviteShows]);

  function pickShow(s: Show) {
    setInviteShows((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
    setShowQuery("");
    setTvResults([]);
  }

  async function pickTvShow(tv: TVmazeShow) {
    if (creatingShow) return;
    setCreatingShow(true);
    try {
      const seasons = await tvmazeEpisodes(tv.id);
      const show = await createShow({ id: slugify(tv.name), name: tv.name, seasons, tvmazeId: String(tv.id), status: tv.status });
      setShows((prev) => (prev.some((s) => s.id === show.id) ? prev : [...prev, show]));
      pickShow(show);
    } catch (e) { console.error("[m-invite] add show from TVMaze failed", e); }
    finally { setCreatingShow(false); }
  }

  // ≥1 complete friend row; in create mode every filled row needs BOTH a name
  // and an email (names drive group naming), plus ≥1 proposed show. (Desktop
  // validation, verbatim.)
  const filledRows = rows.filter((r) => r.email.trim() || r.name.trim());
  const completeRows = filledRows.filter((r) => r.email.includes("@") && (!creating || r.name.trim()));
  const ready = completeRows.length >= 1 && completeRows.length === filledRows.length && (!creating || inviteShows.length >= 1);

  async function sendInvites() {
    if (!user || sending || !ready) return;
    const list = rows.map((r) => ({ name: r.name.trim(), email: r.email.trim() })).filter((r) => r.email);
    setSending(true);
    try {
      const id = targetGroupId ?? (await createPeopleGroup());
      if (creating) {
        setCreatedGroupId(id);
        // Propose the picked shows into the new group (proposing = your yes;
        // a not-started show gets a quiet S0E0 row OUT of the personal pool).
        for (const s of inviteShows) {
          try {
            await setShowVote(id, s.id, true);
            if (!progress[s.id]) await ensureProgressRow(user.id, s.id);
          } catch (e) { console.error("[m-invite] propose into new group failed", e); }
        }
      }
      const out: { email: string; link?: string; error?: string; emailFailed?: boolean }[] = [];
      for (const row of list) {
        try {
          const token = await createPeopleGroupInvite(id, row.email, row.name || undefined);
          // Await the email leg so a silent refusal surfaces as a
          // copy-the-link row instead of a false "Invites sent!".
          const sent = await sendGroupInviteEmail(token);
          out.push({ email: row.email, link: `${window.location.origin}/group-invite/${token}`, emailFailed: !sent.ok });
        } catch (e: any) {
          out.push({ email: row.email, error: e?.message === "group_full" ? "This group is full (8 max)." : (e?.message || "failed") });
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

  // Closing after a successful create lands the user inside the new group.
  function close() {
    if (createdGroupId && onCreated) { onCreated(createdGroupId); return; }
    onClose();
  }

  return (
    <div style={sheet}>
      <button style={sheetClose} onClick={close} aria-label="Close"><X size={20} color={C.cream} /></button>
      <div style={inner}>
        {!links ? (
          <>
            <h1 style={title}>
              {targetGroupId ? <>Connect more friends<br />to this group:</> : <>Email friends to<br />start a watch group:</>}
            </h1>
            {rows.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                  value={row.name}
                  onChange={(e) => setRows((prev) => prev.map((v, j) => (j === i ? { ...v, name: e.target.value } : v)))}
                  placeholder="their name"
                  maxLength={40}
                  className="m-invite-input"
                  style={{ ...emailInput, marginBottom: 0, flex: 0.8, minWidth: 0 }}
                />
                <input
                  value={row.email}
                  onChange={(e) => setRows((prev) => prev.map((v, j) => (j === i ? { ...v, email: e.target.value } : v)))}
                  placeholder="email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="m-invite-input"
                  style={{ ...emailInput, marginBottom: 0, flex: 1.2, minWidth: 0 }}
                />
              </div>
            ))}
            <button
              onClick={() => setRows((prev) => [...prev, { name: "", email: "" }])}
              aria-label="Add another friend"
              style={plusBtn}
            >+</button>
            {/* CP2 create-a-group: pair the invite with ≥1 proposed show. */}
            {creating && (
              <>
                <p style={explainer}>
                  And propose at least one show to watch together:
                </p>
                {inviteShows.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                    {inviteShows.map((s) => (
                      <span key={s.id} style={showChip}>
                        {s.name}
                        <button
                          onClick={() => setInviteShows((prev) => prev.filter((x) => x.id !== s.id))}
                          style={{ border: "none", background: "transparent", color: C.midnight, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}
                          aria-label="remove"
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  value={showQuery}
                  onChange={(e) => setShowQuery(e.target.value)}
                  placeholder="find a show"
                  className="m-invite-input"
                  style={{ ...emailInput, marginBottom: 0 }}
                />
                {(catalogMatches.length > 0 || tvToAdd.length > 0) && (
                  <div style={{ marginTop: 8 }}>
                    {catalogMatches.map((s) => (
                      <button key={s.id} style={resultRow} onClick={() => pickShow(s)}>{s.name}</button>
                    ))}
                    {tvToAdd.map(({ tv, id }) => (
                      <button key={id} style={resultRow} disabled={creatingShow} onClick={() => pickTvShow(tv)}>
                        {tv.name}{networkLabel(tv) ? ` · ${networkLabel(tv)}` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {/* "hi, it's…" removed (first-name identity CP4): the invite
                email introduces the inviter by their first name. */}
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <button style={{ ...sendBtn, opacity: sending || !ready ? 0.6 : 1 }} disabled={sending || !ready} onClick={sendInvites}>
                {sending ? "creating…" : creating ? "create group" : "send invite"}
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
              <button style={sendBtn} onClick={close}>done</button>
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
const showChip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, background: C.cream,
  color: C.midnight, fontWeight: 700, fontSize: 13, padding: "8px 14px", borderRadius: 65,
};
const resultRow: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent",
  padding: "12px 16px", borderRadius: 12, cursor: "pointer", fontFamily: '"Inter", sans-serif',
  fontSize: 15, fontWeight: 600, color: C.cream, minHeight: 44, boxSizing: "border-box",
};
const sendBtn: React.CSSProperties = {
  border: "none", background: C.blue, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "14px 40px", borderRadius: 65, cursor: "pointer", minHeight: 44,
  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};
