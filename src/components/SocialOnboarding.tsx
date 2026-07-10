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
import { tvmazeSearch, tvmazeEpisodes, networkLabel, slugify, type TVmazeShow } from "../lib/tvmaze";
import OneSelectProgress from "./OneSelectProgress";
import ComposeForm, { type ComposeFormHandle } from "./v2/ComposeForm";
import LoadingDots from "./LoadingDots";
import { CANON } from "../styles/canon";
import {
  overlay, searchCard, pickerCard, searchInput, invitePill, searchPill,
  composeBackdrop, composeCardOuter, yellowCard, yellowTitle, startBtn,
} from "./dashboardChrome";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

type Boot = { gid?: string; roomId?: string; token?: string; threadId?: string; attached?: boolean };

export default function SocialOnboarding({ onDone }: { onDone: (groupId: string | null) => void }) {
  const { user, profile } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  // Email backstop's last resort: bootstrap done, email undeliverable →
  // copy-the-link card (shown in place of the compose modal), then step 4.
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Screen 1 — show + progress (the site's real search + picker cards).
  const [shows, setShows] = useState<Show[]>([]);
  const [show, setShow] = useState<Show | null>(null);
  const [prog, setProg] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [creatingShow, setCreatingShow] = useState(false);
  const tvDebounceRef = useRef<number | null>(null);

  // Screen 2 — the one required friend (the site's real invite card).
  const [friendName, setFriendName] = useState("");
  const [friendEmail, setFriendEmail] = useState("");
  const [advancing, setAdvancing] = useState(false);

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
    // Group — left unnamed: the contact-name default names it after the friend.
    if (!boot.gid) boot.gid = await createPeopleGroup();
    // The show room, ALREADY STARTED (the "we went ahead" bootstrap).
    if (!boot.roomId) boot.roomId = (await startShowRoom(boot.gid, show.id)).roomId;
    // The invitation — carries the friend's name (contact naming) + the
    // bootstrap room (auto-opt-in on accept). Email NOT sent yet.
    if (!boot.token) boot.token = await createPeopleGroupInvite(boot.gid, friendEmail.trim(), friendName.trim(), boot.roomId);
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

    // NOW the invite email — held until the writing existed. Transient
    // failure → one auto-retry after a short delay (the button keeps its
    // animated posting… ellipsis); auth failure → straight to copy-the-link.
    const first = await sendGroupInviteEmail(boot.token);
    if (first.ok) { setStep(4); return; }
    const authFail = first.status === 401 || first.status === 403;
    if (!authFail) {
      await new Promise((r) => setTimeout(r, 2500));
      const second = await sendGroupInviteEmail(boot.token);
      if (second.ok) { setStep(4); return; }
    }
    setFallbackLink(`${window.location.origin}/group-invite/${boot.token}`);
  }

  async function copyLink() {
    if (!fallbackLink) return;
    try { await navigator.clipboard.writeText(fallbackLink); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* tolerate */ }
  }

  const emailValid = friendEmail.includes("@") && friendEmail.trim().length >= 5;
  const screen2Ready = friendName.trim().length > 0 && emailValid;

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
            Who&rsquo;s one friend you<br />always text about TV?
          </h1>
          <p style={{ fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, letterSpacing: "normal", color: CANON.cream, textAlign: "center", margin: "0 0 20px" }}>
            (You can invite more later.)
          </p>
          {/* Exactly the standard invite-modal row (Alborz 2026-07-08): name
              + email SIDE BY SIDE (0.8/1.2), "their name" / "email" — two
              equal stacked fields read as one thing. */}
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <input
              value={friendName}
              onChange={(e) => setFriendName(e.target.value)}
              placeholder="their name"
              maxLength={40}
              style={{ ...searchInput, border: "none", background: CANON.cream, color: CANON.dark, marginBottom: 0, flex: 0.8 }}
            />
            <input
              value={friendEmail}
              onChange={(e) => setFriendEmail(e.target.value)}
              placeholder="email"
              style={{ ...searchInput, border: "none", background: CANON.cream, color: CANON.dark, marginBottom: 0, flex: 1.2 }}
            />
          </div>
          {/* "hi, it's…" removed (first-name identity CP4): the invite
              email introduces the inviter by their first name. */}
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
    if (fallbackLink) {
      return (
        <div style={overlay}>
          <div style={{ ...yellowCard, width: "min(420px, 88vw)", textAlign: "left" }}>
            <div style={{ ...yellowTitle, marginBottom: 12 }}>Your writing is published!</div>
            <div style={{ color: CANON.cream, fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
              But Sidebar couldn&rsquo;t email the invite to {friendName.trim() || "your friend"} right now.
              Copy the link and send it to them yourself — it works the same.
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
              <div style={{ flex: 1, fontSize: 12, color: CANON.cream, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fallbackLink}</div>
              <button style={{ ...startBtn, padding: "8px 20px" }} onClick={copyLink}>{copied ? "copied!" : "copy"}</button>
            </div>
            <div style={{ textAlign: "center" }}>
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

  // ── Screen 4: confirmation, straight on the green (no modal). Header 1
  // heading + Header 2 message (§16), with a create-group-sized button. ──────
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ textAlign: "center", maxWidth: 620, padding: "0 24px", pointerEvents: "auto" }}>
        <h1 style={{ ...onbHeading, marginBottom: 24 }}>You&rsquo;re in.</h1>
        <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "normal", lineHeight: 1.7, color: CANON.cream, marginBottom: 36 }}>
          You&rsquo;ve now created a show room for <b>{show?.name}</b>, invited{" "}
          <b>{friendName.trim() || "your friend"}</b>, and left them some writing to read.
          Invite more friends you want to watch with. Sidebar is for writing to your friends.
        </div>
        <button style={invitePill} onClick={() => onDone(bootRef.current.gid ?? null)}>Get started!</button>
      </div>
    </div>
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
