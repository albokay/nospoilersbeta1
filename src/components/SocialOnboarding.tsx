/**
 * SocialOnboarding — the CP3 3-screen first-run flow (desktop), shown ONCE
 * after the TSP demo for brand-new self-signup accounts (invited signups skip
 * it). Binds one show to one friend and seeds a real entry.
 *
 * LOOK-AND-FEEL PASS (2026-07-06): the screens are the site's REAL surfaces,
 * rendered as the site's own overlays above the live dashboard — not special
 * pages. Screen 1 = the real show-search card + "How much have you watched?"
 * picker card; screen 2 = the real invite card (sky); screen 3 = the REAL
 * compose modal (ComposeForm in the show room's shell) with the spec's two
 * deliberate differences: the Header-1 line ("Tell your friend why you're
 * excited about …") and the Identity-fill "Want help with what to write?"
 * prompt button; screen 4 = the site's accent confirm card. Shared styles
 * come from dashboardChrome.ts — one source, no drift.
 *
 * Bootstrap on publish (via ComposeForm's externalSubmit — the form's look
 * and posting… state, our plumbing): group (unnamed — the contact-name
 * default names it after the friend) → show room ALREADY STARTED →
 * invitation (friend's name + the bootstrap room for auto-opt-in) → the
 * entry → the invite email LAST, with the failure backstop: transient
 * failure retries once after a short delay; an auth failure skips the retry
 * and offers copy-the-link immediately. Steps are idempotent across retries.
 * The show progress is persisted when entering screen 3 so the real compose
 * form (which reads it for the header picker + spoiler tag) loads normally.
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
  logThreadPrompt,
  type Show,
} from "../lib/db";
import { Plus } from "lucide-react";
import { tvmazeSearch, tvmazeEpisodes, networkLabel, slugify, type TVmazeShow } from "../lib/tvmaze";
import { joinNames } from "../lib/groupNames";
import OneSelectProgress from "./OneSelectProgress";
import ComposeForm, { type ComposeFormHandle } from "./v2/ComposeForm";
import DeckWave from "./deck/DeckWave";
import YoureInCard from "./deck/YoureInCard";
import LoadingDots from "./LoadingDots";
import { CANON } from "../styles/canon";
import {
  overlay, searchCard, pickerCard, searchInput, invitePill, searchPill,
  composeBackdrop, composeCardOuter, yellowCard, yellowTitle, startBtn,
} from "./dashboardChrome";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

type Boot = { gid?: string; roomId?: string; tokens?: Record<string, string>; threadId?: string; attached?: boolean };

// Multi-friend onboarding (Alborz 2026-07-20): up to 7 friends in one pass —
// the room cap is 8 MEMBERS including you (checked at invite-mint AND accept),
// so an 8th invitee would bounce with "group full" when they tried to join.
const MAX_FRIENDS = 7;

export default function SocialOnboarding({ onDone }: { onDone: (groupId: string | null) => void }) {
  const { user, profile } = useAuth();
  // Swipe-deck arc CP2 (spec §12.1): step 0 = WAVE 1 (4 question cards with
  // the welcome copy), steps 1–3 = the original show → friend → seed-entry
  // screens, step 4 = WAVE 2 ("a few more…"), step 5 = the "You're in!" card.
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  // Email backstop's last resort: bootstrap done, email(s) undeliverable →
  // copy-the-link card (one row per failed invite), then step 4.
  const [fallbackLinks, setFallbackLinks] = useState<{ name: string; link: string }[] | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Screen 1 — show + progress (the site's real search + picker cards).
  const [shows, setShows] = useState<Show[]>([]);
  const [show, setShow] = useState<Show | null>(null);
  const [prog, setProg] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [creatingShow, setCreatingShow] = useState(false);
  const tvDebounceRef = useRef<number | null>(null);

  // Screen 2 — at least one friend, up to MAX_FRIENDS at once (the "+" row).
  const [friends, setFriends] = useState<{ name: string; email: string }[]>([{ name: "", email: "" }]);
  const [advancing, setAdvancing] = useState(false);
  function setFriendField(i: number, field: "name" | "email", v: string) {
    setFriends((prev) => prev.map((f, j) => (j === i ? { ...f, [field]: v } : f)));
  }

  const bootRef = useRef<Boot>({});
  const composeRef = useRef<ComposeFormHandle>(null);

  useEffect(() => {
    let cancelled = false;
    fetchShows().then((rows) => { if (!cancelled) setShows(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Show search: catalog matches + debounced TVMaze lookup for new shows —
  // same behavior as the group room's search overlay.
  const catalogMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shows.filter((s) => !s.isHidden && s.name.toLowerCase().includes(q)).slice(0, 8);
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
      if (out.length >= 8) break;
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

  // Screen 2 → 3: persist the declared progress so the REAL compose form
  // (which reads the progress row for its header picker + spoiler tag)
  // loads normally. The picker inside compose stays live and persists any
  // further change itself.
  async function advanceToCompose() {
    if (!user || !show || advancing) return;
    setAdvancing(true);
    try {
      await upsertRewatchStatus(user.id, show.id, { s: prog.s, e: prog.e, highestS: prog.s, highestE: prog.e });
      setStep(3);
    } catch (e) { console.error("[onboarding] progress write failed", e); }
    finally { setAdvancing(false); }
  }

  // The bootstrap — runs inside ComposeForm's externalSubmit, so the button
  // shows the form's own posting… state. Every step keeps its created id in
  // bootRef so a retry after a mid-sequence failure resumes, not duplicates.
  async function publishAndInvite(data: {
    title: string; body: string; preview: string;
    season: number; episode: number;
    isRewatch: boolean; rewatchSeason?: number; rewatchEpisode?: number;
    insertedPromptIds: number[];
  }) {
    if (!user || !profile?.username || !show) return;
    const boot = bootRef.current;
    // Group — left unnamed: the contact-name default names it after the friends.
    if (!boot.gid) boot.gid = await createPeopleGroup();
    // The show room, ALREADY STARTED (the "we went ahead" bootstrap).
    if (!boot.roomId) boot.roomId = (await startShowRoom(boot.gid, show.id)).roomId;
    // The invitations — each carries the friend's name (contact naming) + the
    // bootstrap room (auto-opt-in on accept). Emails NOT sent yet. Tokens are
    // keyed by email so a retry resumes without double-minting.
    const invitees = friends
      .map((f) => ({ name: f.name.trim(), email: f.email.trim().toLowerCase() }))
      .filter((f) => f.name && f.email.includes("@"));
    if (!boot.tokens) boot.tokens = {};
    for (const f of invitees) {
      if (!boot.tokens[f.email]) boot.tokens[f.email] = await createPeopleGroupInvite(boot.gid, f.email, f.name, boot.roomId);
    }
    // The seed entry, into the room — tagged exactly as the compose form
    // would have tagged it.
    if (!boot.threadId) {
      const thread = await insertThread({
        showId: show.id, season: data.season, episode: data.episode,
        authorId: user.id, authorName: profile.username,
        title: data.title, preview: data.preview, body: data.body,
        isPublic: false,
        isRewatch: data.isRewatch, rewatchSeason: data.rewatchSeason, rewatchEpisode: data.rewatchEpisode,
      });
      boot.threadId = thread.id;
    }
    if (!boot.attached) {
      await addThreadToGroup(boot.threadId, boot.roomId);
      boot.attached = true;
      for (const pid of data.insertedPromptIds) logThreadPrompt(boot.threadId, pid).catch(() => {});
    }
    // The onboarding sticky shows on THIS group's room after landing.
    try { localStorage.setItem("ns_onb_group", boot.gid); } catch { /* tolerate */ }

    // NOW the invite emails — held until the writing existed. Transient
    // failures → one auto-retry after a short delay (the button keeps its
    // animated posting… ellipsis); an auth failure skips the retry and the
    // failed invites go straight to copy-the-link rows.
    let failed: { name: string; email: string; token: string }[] = [];
    let authFail = false;
    for (const f of invitees) {
      const r = await sendGroupInviteEmail(boot.tokens[f.email]);
      if (!r.ok) {
        failed.push({ ...f, token: boot.tokens[f.email] });
        if (r.status === 401 || r.status === 403) authFail = true;
      }
    }
    if (failed.length && !authFail) {
      await new Promise((r) => setTimeout(r, 2500));
      const still: typeof failed = [];
      for (const f of failed) {
        const r = await sendGroupInviteEmail(f.token);
        if (!r.ok) still.push(f);
      }
      failed = still;
    }
    if (!failed.length) { setStep(4); return; }
    setFallbackLinks(failed.map((f) => ({ name: f.name, link: `${window.location.origin}/group-invite/${f.token}` })));
  }

  async function copyLink(link: string, idx: number) {
    try { await navigator.clipboard.writeText(link); setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 1500); } catch { /* tolerate */ }
  }

  // Row validation: at least one COMPLETE row, and no half-filled rows
  // (a name without an email or vice versa blocks the button).
  const emailOk = (e: string) => e.includes("@") && e.trim().length >= 5;
  const touchedRows = friends.filter((f) => f.name.trim() || f.email.trim());
  const completeRows = friends.filter((f) => f.name.trim() && emailOk(f.email));
  const screen2Ready = completeRows.length >= 1 && touchedRows.every((f) => f.name.trim() && emailOk(f.email));
  const invitedNames = joinNames(completeRows.map((f) => f.name.trim()));

  // ── Screen 0: WAVE 1 — 4 question cards with the welcome copy (§12.4).
  // Self-skipping: an account that already answered them passes straight
  // through (e.g. a returning 0-group user re-guided by the gate). ──────────
  if (step === 0) {
    return <DeckWave wave={1} heading="welcome" idiom="desktop" onComplete={() => setStep(1)} />;
  }

  // ── Screen 1: search button → the site's search card → picker card ─────────
  // Anchored near the top (NOT flex-centered): the heading holds its position
  // while the card beneath grows/shrinks with the results.
  if (step === 1) {
    return (
      <div style={{ ...overlay, background: "transparent", flexDirection: "column", justifyContent: "flex-start", paddingTop: "16vh", gap: 28, overflowY: "auto" }}>
        <div style={{ textAlign: "center", maxWidth: 640, padding: "0 24px" }}>
          <h1 style={onbHeading}>What&rsquo;s the show you&rsquo;re most excited to watch with a friend?</h1>
          <div style={onbSubline}>(You can add more later.)</div>
        </div>
        {!show && !searchOpen && (
          <button style={searchPill} onClick={() => setSearchOpen(true)}>Find your show</button>
        )}
        {!show && searchOpen && (
          <div style={searchCard}>
            <input
              autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="find your show" style={searchInput}
            />
            {catalogMatches.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {catalogMatches.map((s) => (
                  <button key={s.id} className="dash-result" onClick={() => pickShow(s)}>{s.name}</button>
                ))}
              </div>
            )}
            {tvToAdd.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {catalogMatches.length > 0 && (
                  <div style={{ padding: "4px 16px 6px", fontSize: 11, fontWeight: 700, color: CANON.dark, opacity: 0.6 }}>Not in the list? Add it:</div>
                )}
                {tvToAdd.map(({ tv, id }) => (
                  <button key={id} className="dash-result" disabled={creatingShow} onClick={() => pickTvShow(tv)}>
                    {tv.name}{networkLabel(tv) ? ` · ${networkLabel(tv)}` : ""}
                  </button>
                ))}
              </div>
            )}
            {query.trim().length >= 2 && catalogMatches.length === 0 && tvToAdd.length === 0 && (
              <div style={{ padding: "12px 16px", fontSize: 13, color: CANON.dark, opacity: 0.6 }}>
                {creatingShow ? "adding…" : "searching…"}
              </div>
            )}
          </div>
        )}
        {show && (
          <div style={{ ...pickerCard, position: "relative" }}>
            <button style={{ ...backLink, color: CANON.personal }} onClick={() => setShow(null)}>← back</button>
            <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: 0, color: CANON.personal }}>
              {show.name}
            </div>
            <div style={{ marginTop: 24, color: CANON.personal, fontWeight: 600, fontSize: 13, letterSpacing: -1, textAlign: "center" }}>
              How much have you watched?
            </div>
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
            <button style={{ ...invitePill, marginTop: 24 }} onClick={() => setStep(2)}>next</button>
          </div>
        )}
      </div>
    );
  }

  // ── Screen 2: the site's invite card (sky) ──────────────────────────────────
  if (step === 2) {
    return (
      <div style={overlay}>
        <div style={{ ...searchCard, background: CANON.friend, position: "relative" }}>
          <button style={backLink} onClick={() => setStep(1)}>← back</button>
          <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 30, letterSpacing: 0, color: CANON.cream, textAlign: "center", margin: "16px 0 8px" }}>
            Who&rsquo;s at least one friend<br />you always text about TV?
          </h1>
          <p style={{ fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, letterSpacing: "normal", color: CANON.cream, textAlign: "center", margin: "0 0 20px" }}>
            (You can invite more later.)
          </p>
          {/* The standard invite-modal row (name + email SIDE BY SIDE,
              0.8/1.2) × up to MAX_FRIENDS; the cream "+" circle appends a
              row (Alborz 2026-07-20). */}
          {friends.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <input
                value={f.name}
                onChange={(e) => setFriendField(i, "name", e.target.value)}
                placeholder="their name"
                maxLength={40}
                style={{ ...searchInput, border: "none", background: CANON.cream, color: CANON.dark, marginBottom: 0, flex: 0.8 }}
              />
              <input
                value={f.email}
                onChange={(e) => setFriendField(i, "email", e.target.value)}
                placeholder="email"
                style={{ ...searchInput, border: "none", background: CANON.cream, color: CANON.dark, marginBottom: 0, flex: 1.2 }}
              />
            </div>
          ))}
          {friends.length < MAX_FRIENDS && (
            <button
              title="invite another friend"
              onClick={() => setFriends((prev) => [...prev, { name: "", email: "" }])}
              style={plusBtn}
            >
              <Plus size={18} strokeWidth={2.5} color={CANON.friend} />
            </button>
          )}
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <button
              style={{ ...invitePill, opacity: screen2Ready && !advancing ? 1 : 0.6 }}
              disabled={!screen2Ready || advancing}
              onClick={advanceToCompose}
            >
              {advancing ? <>one moment<LoadingDots /></> : "Invite"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Screen 3: the REAL compose modal (or the copy-link fallback card) ──────
  if (step === 3 && show) {
    if (fallbackLinks) {
      return (
        <div style={overlay}>
          <div style={{ ...yellowCard, width: "min(460px, 88vw)", textAlign: "left" }}>
            <div style={{ ...yellowTitle, marginBottom: 12 }}>Your writing is published!</div>
            <div style={{ color: CANON.cream, fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
              But Sidebar couldn&rsquo;t email {joinNames(fallbackLinks.map((f) => f.name)) || "your friends"} right now.
              Copy the link{fallbackLinks.length > 1 ? "s" : ""} and send them yourself — they work the same.
            </div>
            {fallbackLinks.map((f, i) => (
              <div key={f.link} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <div style={{ width: 90, fontSize: 12, fontWeight: 700, color: CANON.cream, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                <div style={{ flex: 1, fontSize: 12, color: CANON.cream, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.link}</div>
                <button style={{ ...startBtn, padding: "8px 20px" }} onClick={() => copyLink(f.link, i)}>{copiedIdx === i ? "copied!" : "copy"}</button>
              </div>
            ))}
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button style={startBtn} onClick={() => setStep(4)}>continue →</button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div style={composeBackdrop}>
        <div style={composeCardOuter}>
          {/* Back replaces the compose modal's "not now" exits (no skipping
              out) — routed through the form's discard check so typed writing
              still gets its "discard?" confirm. */}
          <button
            style={{ ...backLink, color: CANON.identity, zIndex: 30, position: "absolute", top: 20, left: 24 }}
            onClick={() => composeRef.current?.attemptDiscard()}
          >← back</button>
          <ComposeForm
            ref={composeRef}
            showId={show.id}
            privateOnly
            hideTopRightClose
            hideCancel
            onCancel={() => setStep(2)}
            onSubmitted={() => {}}
            initialTitle="Let's do this!"
            headingOverride={
              <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: 0, color: CANON.identity, margin: "0 0 10px" }}>
                Tell your friend why you&rsquo;re excited about <b>{show.name}</b>:
              </h1>
            }
            promptButton={{ label: "Want help with what to write?", background: `var(--canon-identity, ${CANON.identity})` }}
            // Onboarding-only prompt batch (2026-07-08), split on the
            // declared progress: fresh = s0e0 through s1e4, else returning.
            promptPoolTag={prog.s < 1 || (prog.s === 1 && prog.e <= 4) ? "onb-fresh" : "onb-returning"}
            externalSubmit={{ label: "publish & invite", onSubmit: publishAndInvite }}
          />
        </div>
      </div>
    );
  }

  // ── Screen 4: WAVE 2 — 4 more cards, "a few more…" (§12.5). Fires on
  // onboarding COMPLETION (the bootstrap succeeded or fell back to
  // copy-the-link); self-skipping like wave 1. ───────────────────────────────
  if (step === 4) {
    return <DeckWave wave={2} heading="more" idiom="desktop" onComplete={() => setStep(5)} />;
  }

  // ── Screen 5: the "You're in!" card (§12.6, inviter variant). ─────────────
  return (
    <YoureInCard
      idiom="desktop"
      variant={{ kind: "inviter", showName: show?.name ?? "your show", friendName: invitedNames || "your friend" }}
      onDone={() => onDone(bootRef.current.gid ?? null)}
    />
  );
}

// The only onboarding-specific chrome: the screen-1 question floats above the
// site's card, cream on the dimmed dashboard (§16 Header 1 / Body).
const onbHeading: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 34, lineHeight: 1.2, letterSpacing: 0, color: CANON.cream, margin: 0,
};
const onbSubline: React.CSSProperties = {
  fontFamily: "Inter, sans-serif", fontSize: 13, color: CANON.cream, marginTop: 10,
};
const backLink: React.CSSProperties = {
  position: "absolute", top: 14, left: 18, border: "none", background: "transparent",
  color: CANON.cream, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 4,
};
// The "+" add-a-friend circle: cream (site-white) with a Sky plus,
// left-justified under the rows.
const plusBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: "50%", border: "none", background: CANON.cream,
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
  padding: 0, marginTop: 2,
};
