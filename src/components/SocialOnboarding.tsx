/**
 * SocialOnboarding — the CP3 3-screen first-run flow (desktop), shown ONCE
 * after the TSP demo for brand-new self-signup accounts (invited signups skip
 * it). Binds one show to one friend and seeds a real entry:
 *
 *   1. pick the show (+ progress)      "What's the show you're most excited…"
 *   2. one friend, name + email        (required — no skip)
 *   3. write the seed entry            (compose-style; publish runs the
 *                                       bootstrap and ONLY THEN sends the
 *                                       invite email)
 *   4. confirmation → dashboard        (lands inside the new group)
 *
 * Bootstrap on publish: progress → group (unnamed — the contact-name default
 * names it after the friend) → show room ALREADY STARTED → invitation
 * (carries the friend's name + the bootstrap room for auto-opt-in on accept)
 * → entry into the room → invite email LAST, with the failure backstop:
 * transient failure retries once after a short delay (animated ellipsis);
 * an auth failure skips the retry and offers copy-the-link immediately.
 * Every bootstrap step is idempotent across retries (created ids are kept).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import {
  fetchShows,
  createShow,
  upsertRewatchStatus,
  createPeopleGroup,
  startShowRoom,
  createPeopleGroupInvite,
  sendGroupInviteEmail,
  insertThread,
  addThreadToGroup,
  fetchPrompts,
  logThreadPrompt,
  type Show,
  type PromptRow,
} from "../lib/db";
import { tvmazeSearch, tvmazeEpisodes, networkLabel, slugify, type TVmazeShow } from "../lib/tvmaze";
import { getPromptSuggestion } from "../lib/prompts";
import type { PromptEntry } from "../lib/promptData";
import OneSelectProgress from "./OneSelectProgress";
import PromptCard from "./PromptCard";
import LoadingDots from "./LoadingDots";
import SidebarLogo from "./SidebarLogo";
import { CANON } from "../styles/canon";

const LORA = '"Lora", Georgia, serif';

type Boot = { gid?: string; roomId?: string; token?: string; threadId?: string; attached?: boolean };
type PublishState = "idle" | "working" | "sending" | "retrying" | "fallback";

export default function SocialOnboarding({ onDone }: { onDone: (groupId: string | null) => void }) {
  const { user, profile } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Screen 1 — show + progress.
  const [shows, setShows] = useState<Show[]>([]);
  const [show, setShow] = useState<Show | null>(null);
  const [prog, setProg] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [query, setQuery] = useState("");
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [creatingShow, setCreatingShow] = useState(false);
  const tvDebounceRef = useRef<number | null>(null);

  // Screen 2 — the one required friend.
  const [friendName, setFriendName] = useState("");
  const [friendEmail, setFriendEmail] = useState("");

  // Screen 3 — the seed entry (compose-style).
  const [title, setTitle] = useState("Let's do this!");
  const [body, setBody] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [promptEntries, setPromptEntries] = useState<PromptEntry[]>([]);
  const [activePrompt, setActivePrompt] = useState<PromptEntry | null>(null);
  const [shownPromptIds, setShownPromptIds] = useState<number[]>([]);
  const [insertedPromptIds, setInsertedPromptIds] = useState<number[]>([]);
  const [publishState, setPublishState] = useState<PublishState>("idle");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const bootRef = useRef<Boot>({});

  // Catalog + prompts (both tolerant; the catalog read is the warm cache).
  useEffect(() => {
    let cancelled = false;
    fetchShows().then((rows) => { if (!cancelled) setShows(rows); }).catch(() => {});
    fetchPrompts()
      .then((pr: PromptRow[]) => {
        if (cancelled) return;
        setPromptEntries(pr.map((r) => ({
          id: r.id, text: r.text, displayType: r.display_type, tvmazeTypes: r.tvmaze_types,
          genres: r.genres, progressTags: r.progress_tags, themes: r.themes,
        })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Show search: catalog matches + debounced TVMaze lookup for new shows.
  const catalogMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shows.filter((s) => !s.isHidden && s.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, shows]);

  useEffect(() => {
    const q = query.trim();
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
  }, [query]);

  const tvToAdd = useMemo(() => {
    const known = new Set(shows.map((s) => s.id));
    const seen = new Set<string>();
    const out: { tv: TVmazeShow; id: string }[] = [];
    for (const tv of tvResults) {
      const id = slugify(tv.name);
      if (known.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ tv, id });
      if (out.length >= 6) break;
    }
    return out;
  }, [tvResults, shows]);

  function pickShow(s: Show) {
    setShow(s);
    setProg({ s: 0, e: 0 });
    setQuery("");
    setTvResults([]);
  }

  async function pickTvShow(tv: TVmazeShow) {
    if (creatingShow) return;
    setCreatingShow(true);
    try {
      const seasons = await tvmazeEpisodes(tv.id);
      const created = await createShow({ id: slugify(tv.name), name: tv.name, seasons, tvmazeId: String(tv.id), status: tv.status });
      setShows((prev) => (prev.some((s) => s.id === created.id) ? prev : [...prev, created]));
      pickShow(created);
    } catch (e) { console.error("[onboarding] add show from TVMaze failed", e); }
    finally { setCreatingShow(false); }
  }

  // Prompt helper — same mechanics as the compose form ([PROMPT: …] token).
  function handlePromptBtn() {
    if (!show) return;
    const next = getPromptSuggestion(show, { s: prog.s, e: prog.e }, shownPromptIds, promptEntries);
    if (next) {
      setShownPromptIds((prev) => [...prev, next.id]);
      setActivePrompt(next);
    }
  }
  function handlePromptInsert(text: string) {
    if (!activePrompt) return;
    const token = `[PROMPT: ${text}]`;
    const ta = bodyRef.current;
    if (ta) {
      const pos = ta.selectionStart ?? body.length;
      const before = body.slice(0, pos).trimEnd();
      const after = body.slice(pos).trimStart();
      const prefix = before.length ? "\n" : "";
      const newBody = before + prefix + token + "\n" + after;
      setBody(newBody);
      requestAnimationFrame(() => { ta.focus(); });
    } else {
      setBody((prev) => prev.trimEnd() + (prev.trim() ? "\n" : "") + token + "\n");
    }
    setInsertedPromptIds((prev) => [...prev, activePrompt.id]);
    setActivePrompt(null);
  }

  // The bootstrap. Every step keeps its created id in bootRef so a retry
  // after a mid-sequence failure resumes instead of duplicating.
  async function doPublish() {
    if (!user || !profile?.username || !show) return;
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) { setPublishError("Add a title and some text to publish."); return; }
    setPublishState("working");
    setPublishError(null);
    const boot = bootRef.current;
    try {
      // Your watch position (also the entry's spoiler tag).
      await upsertRewatchStatus(user.id, show.id, { s: prog.s, e: prog.e, highestS: prog.s, highestE: prog.e });
      // Group — left unnamed: the contact-name default names it after the friend.
      if (!boot.gid) boot.gid = await createPeopleGroup();
      // The show room, ALREADY STARTED (the "we went ahead" bootstrap).
      if (!boot.roomId) boot.roomId = (await startShowRoom(boot.gid, show.id)).roomId;
      // The invitation — carries the friend's name (contact naming) + the
      // bootstrap room (auto-opt-in on accept). Email NOT sent yet.
      if (!boot.token) boot.token = await createPeopleGroupInvite(boot.gid, friendEmail.trim(), friendName.trim(), boot.roomId);
      // The seed entry, into the room.
      if (!boot.threadId) {
        const thread = await insertThread({
          showId: show.id, season: prog.s, episode: prog.e,
          authorId: user.id, authorName: profile.username,
          title: t, preview: b.slice(0, 240) + (b.length > 240 ? "…" : ""), body: b,
          isPublic: false,
        });
        boot.threadId = thread.id;
      }
      if (!boot.attached) {
        await addThreadToGroup(boot.threadId, boot.roomId);
        boot.attached = true;
        for (const pid of insertedPromptIds) logThreadPrompt(boot.threadId, pid).catch(() => {});
      }
      // The onboarding sticky shows on THIS group's room after landing.
      try { localStorage.setItem("ns_onb_group", boot.gid); } catch { /* tolerate */ }

      // NOW the invite email — held until the writing existed. Backstop:
      // transient failure → one auto-retry after a short delay; auth failure
      // → no retry, straight to the copy-the-link fallback.
      setPublishState("sending");
      const first = await sendGroupInviteEmail(boot.token);
      if (first.ok) { setPublishState("idle"); setStep(4); return; }
      const authFail = first.status === 401 || first.status === 403;
      if (!authFail) {
        setPublishState("retrying");
        await new Promise((r) => setTimeout(r, 2500));
        const second = await sendGroupInviteEmail(boot.token);
        if (second.ok) { setPublishState("idle"); setStep(4); return; }
      }
      setInviteLink(`${window.location.origin}/group-invite/${boot.token}`);
      setPublishState("fallback");
    } catch (e) {
      console.error("[onboarding] publish failed", e);
      setPublishState("idle");
      setPublishError("Something went wrong. Nothing was lost — try publishing again.");
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    try { await navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* tolerate */ }
  }

  const emailValid = friendEmail.includes("@") && friendEmail.trim().length >= 5;
  const screen2Ready = friendName.trim().length > 0 && emailValid;
  const busy = publishState === "working" || publishState === "sending" || publishState === "retrying";

  return (
    <div style={page}>
      <div style={{ padding: "16px 28px" }}>
        <SidebarLogo scale={0.5} blocksOpacity={1} bg="green" />
      </div>

      <div style={column}>
        {(step === 2 || step === 3) && !busy && publishState !== "fallback" && (
          <button style={backBtn} onClick={() => setStep((step - 1) as 1 | 2)}>←</button>
        )}

        {step === 1 && (
          <>
            <h1 style={h1}>What&rsquo;s the show you&rsquo;re most excited to watch with a friend?</h1>
            <div style={subline}>(You can add more later.)</div>
            {!show ? (
              <div style={card}>
                <input
                  autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="find your show" style={field}
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
                {creatingShow && <div style={{ ...subline, marginTop: 8 }}>adding<LoadingDots /></div>}
              </div>
            ) : (
              <>
                <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 34, color: CANON.cream, marginTop: 8 }}>{show.name}</div>
                <button style={quietLink} onClick={() => setShow(null)}>pick a different show</button>
                <div style={{ ...subline, marginTop: 24 }}>How much have you watched?</div>
                <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
                  <OneSelectProgress
                    show={show}
                    value={{ s: 0, e: 0 }}
                    allowZero
                    requireConfirm={false}
                    onChangeSelected={(v) => setProg(v)}
                    onConfirm={() => {}}
                  />
                </div>
                <button style={{ ...primaryBtn, marginTop: 32 }} onClick={() => setStep(2)}>next</button>
              </>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <h1 style={h1}>Who&rsquo;s one friend you always text about TV?</h1>
            <div style={subline}>(You can invite more later.)</div>
            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
              <input value={friendName} onChange={(e) => setFriendName(e.target.value)} placeholder="their name" maxLength={40} style={field} />
              <input value={friendEmail} onChange={(e) => setFriendEmail(e.target.value)} placeholder="their email" style={field} />
            </div>
            <button
              style={{ ...primaryBtn, marginTop: 24, opacity: screen2Ready ? 1 : 0.6 }}
              disabled={!screen2Ready}
              onClick={() => setStep(3)}
            >Invite</button>
          </>
        )}

        {step === 3 && show && (
          <>
            <h1 style={h1}>Tell your friend why you&rsquo;re excited about <b>{show.name}</b>:</h1>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
              <OneSelectProgress
                show={show}
                value={prog}
                allowZero
                requireConfirm={false}
                onChangeSelected={(v) => setProg(v)}
                onConfirm={() => {}}
              />
            </div>
            <div style={{ ...card, textAlign: "left", marginTop: 20 }}>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                style={{ ...field, fontWeight: 700, marginBottom: 10 }}
              />
              <textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What are you hoping for? What should they know going in?"
                rows={8}
                style={{ ...field, borderRadius: 15, resize: "vertical", lineHeight: 1.5, fontFamily: LORA }}
              />
              <div style={{ marginTop: 12 }}>
                {!activePrompt ? (
                  promptEntries.length > 0 && (
                    <button style={helpBtn} onClick={handlePromptBtn}>Want help with what to write?</button>
                  )
                ) : (
                  <PromptCard
                    prompt={activePrompt}
                    onClose={() => setActivePrompt(null)}
                    onShuffle={handlePromptBtn}
                    onInsert={handlePromptInsert}
                  />
                )}
              </div>
            </div>

            {publishState === "fallback" ? (
              <div style={{ ...card, textAlign: "left", marginTop: 16 }}>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: CANON.dark }}>
                  Your writing is published and the room is ready — but Sidebar couldn&rsquo;t
                  email the invite to {friendName.trim() || "your friend"} right now. Copy the
                  link and send it to them yourself; it works the same.
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
                  <div style={{ flex: 1, fontSize: 12, color: CANON.dark, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inviteLink}</div>
                  <button style={{ ...primaryBtn, padding: "10px 24px" }} onClick={copyLink}>{copied ? "copied!" : "copy"}</button>
                </div>
                <div style={{ textAlign: "center", marginTop: 16 }}>
                  <button style={primaryBtn} onClick={() => setStep(4)}>continue →</button>
                </div>
              </div>
            ) : (
              <>
                {publishError && <div style={{ color: CANON.alert, fontWeight: 700, fontSize: 13, marginTop: 14 }}>{publishError}</div>}
                <button
                  style={{ ...primaryBtn, marginTop: 20, opacity: busy || !title.trim() || !body.trim() ? 0.6 : 1 }}
                  disabled={busy || !title.trim() || !body.trim()}
                  onClick={doPublish}
                >
                  {publishState === "working" ? <>setting things up<LoadingDots /></>
                    : publishState === "sending" ? <>sending the invite<LoadingDots /></>
                    : publishState === "retrying" ? <>still sending<LoadingDots /></>
                    : "publish & invite"}
                </button>
              </>
            )}
          </>
        )}

        {step === 4 && show && (
          <>
            <h1 style={h1}>You&rsquo;re in.</h1>
            <p style={{ fontFamily: "Inter, sans-serif", fontSize: 15, lineHeight: 1.6, color: CANON.cream, maxWidth: 520, margin: "20px auto 0" }}>
              You&rsquo;ve now created a show room for <b>{show.name}</b>, invited{" "}
              <b>{friendName.trim() || "your friend"}</b>, and left them some writing to read.
              Invite more friends you want to watch with. Sidebar is for writing to your friends.
            </p>
            <button style={{ ...primaryBtn, marginTop: 32 }} onClick={() => onDone(bootRef.current.gid ?? null)}>Get started!</button>
          </>
        )}

        {/* Position dots (display-only). */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 48 }}>
          {[1, 2, 3, 4].map((n) => (
            <span key={n} style={{ width: 10, height: 10, borderRadius: "50%", background: n === step ? CANON.accent : "rgba(222,168,56,0.35)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const page: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 80, overflowY: "auto",
  background: `var(--canon-personal, ${CANON.personal})`,
  fontFamily: '"Inter", system-ui, sans-serif',
};
const column: React.CSSProperties = {
  maxWidth: 640, margin: "0 auto", padding: "24px 24px 80px", textAlign: "center", position: "relative",
};
const h1: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 34, lineHeight: 1.2, letterSpacing: 0, color: CANON.cream, margin: "24px 0 0",
};
const subline: React.CSSProperties = {
  fontFamily: "Inter, sans-serif", fontSize: 13, color: CANON.cream, marginTop: 10,
};
const card: React.CSSProperties = {
  background: "rgba(253,248,236,0.14)", borderRadius: 15, padding: 18, marginTop: 24, textAlign: "center",
};
const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "none", background: CANON.cream, color: CANON.dark,
  borderRadius: 65, padding: "14px 20px", fontSize: 15, fontFamily: "Inter, sans-serif", outline: "none",
};
const resultRow: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent",
  color: CANON.cream, fontWeight: 700, fontSize: 14, padding: "10px 14px", cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  border: "none", background: `var(--canon-accent, ${CANON.accent})`, color: CANON.cream, fontWeight: 700,
  fontSize: 14, padding: "16px 56px", borderRadius: 65, cursor: "pointer",
};
// "Want help with what to write?" — Identity fill + cream text (spec).
const helpBtn: React.CSSProperties = {
  border: "none", background: `var(--canon-identity, ${CANON.identity})`, color: CANON.cream, fontWeight: 700,
  fontSize: 13, padding: "10px 20px", borderRadius: 65, cursor: "pointer",
};
const quietLink: React.CSSProperties = {
  border: "none", background: "transparent", color: CANON.cream, opacity: 0.8, fontSize: 12,
  textDecoration: "underline", cursor: "pointer", marginTop: 6,
};
const backBtn: React.CSSProperties = {
  position: "absolute", left: 0, top: 0, border: "none", background: "transparent",
  color: CANON.cream, fontSize: 24, cursor: "pointer", lineHeight: 1,
};
