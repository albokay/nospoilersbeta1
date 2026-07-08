/**
 * MobileSocialOnboarding — the CP3 3-screen first-run flow, mobile-native
 * (mobile mirror arc 2026-07-07). Same product as desktop's SocialOnboarding:
 * shown ONCE for brand-new self-signup accounts (invited signups skip it; no
 * TSP demo on mobile per Alborz), binds one show to one friend and seeds a
 * real entry. No skip/escape by design.
 *
 * The screens reuse the REAL mobile surfaces (desktop parity by structure):
 * screen 1 = the onboarding question over the plain green + the shared
 * MobileSearchSheet (search + "How much have you watched?" picker in one);
 * screen 2 = the invite sheet's visual language (sky, cream fields); screen
 * 3 = the show room's full-screen compose shell around the REAL ComposeForm
 * (mobileIdiom) with the spec's two deliberate differences — the Header-1
 * "Tell your friend why you're excited about …" line and the Identity-fill
 * "Want help with what to write?" prompt button; screen 4 = the confirm,
 * straight on the green (click-through wrapper so the top bar stays alive).
 * Full-screen panels CENTER their elements (mobile idiom).
 *
 * Bootstrap on publish (via ComposeForm's externalSubmit; every step keeps
 * its created id in bootRef so a retry resumes, not duplicates): group
 * (unnamed — the contact-name default names it after the friend) → show room
 * ALREADY STARTED → invitation (friend's name + the bootstrap room for
 * auto-opt-in) → the seed entry → the invite email LAST, with the desktop
 * backstop: transient failure retries once after 2.5s; an auth failure skips
 * the retry and offers copy-the-link immediately. The declared progress is
 * persisted at screen 2→3 so the real compose form loads normally.
 */
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { CANON } from "../styles/canon";
import LoadingDots from "../components/LoadingDots";
import OneSelectProgress from "../components/OneSelectProgress";
import ComposeForm, { type ComposeFormHandle } from "../components/v2/ComposeForm";
import MobileSearchSheet from "./MobileSearchSheet";
import {
  fetchShows,
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

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const C = {
  green: CANON.personal,
  sky: CANON.friend,
  blue: CANON.identity,
  yellow: CANON.accent,
  cream: CANON.cream,
  midnight: CANON.dark,
};

type Boot = { gid?: string; roomId?: string; token?: string; threadId?: string; attached?: boolean };

export default function MobileSocialOnboarding({ onDone }: { onDone: (groupId: string | null) => void }) {
  const { user, profile } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  // Email backstop's last resort: bootstrap done, email undeliverable →
  // copy-the-link panel (shown in place of the compose), then step 4.
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Screen 1 — show + progress (the shared search sheet picks both).
  const [shows, setShows] = useState<Show[]>([]);
  const [show, setShow] = useState<Show | null>(null);
  const [prog, setProg] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchShows().then((rows) => { if (!cancelled) setShows(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Screen 2 — the one required friend.
  const [friendName, setFriendName] = useState("");
  const [friendEmail, setFriendEmail] = useState("");
  // Optional "hi, it's…" (2026-07-07, invite-sheet parity): rides the invite
  // email so the friend knows who's asking, and seeds THEIR contact name for
  // the inviter on accept (the send fn writes it best-effort at email time).
  const [fromName, setFromName] = useState("");
  const [advancing, setAdvancing] = useState(false);

  const bootRef = useRef<Boot>({});
  const composeRef = useRef<ComposeFormHandle>(null);

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
    } catch (e) { console.error("[m-onboarding] progress write failed", e); }
    finally { setAdvancing(false); }
  }

  // The bootstrap — runs inside ComposeForm's externalSubmit, so the button
  // shows the form's own posting… state. (Desktop's publishAndInvite, verbatim.)
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
    const first = await sendGroupInviteEmail(boot.token, fromName.trim() || undefined);
    if (first.ok) { setStep(4); return; }
    const authFail = first.status === 401 || first.status === 403;
    if (!authFail) {
      await new Promise((r) => setTimeout(r, 2500));
      const second = await sendGroupInviteEmail(boot.token, fromName.trim() || undefined);
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

  // ── Screen 1: the question over the plain green; the shared search sheet
  //    picks the show + progress in one pass. A picked show renders the
  //    picker panel (back-from-screen-2 state) so progress can be revisited
  //    without re-searching. ─────────────────────────────────────────────────
  if (step === 1) {
    return (
      <>
        <div style={{ ...fullScreen, background: "transparent", justifyContent: "flex-start", paddingTop: "18vh" }}>
          <div style={{ textAlign: "center", maxWidth: 420, padding: "0 24px" }}>
            <h1 style={onbHeading}>What&rsquo;s the show you&rsquo;re most excited to watch with a friend?</h1>
            <div style={onbSubline}>(You can add more later.)</div>
          </div>
          {!show && (
            <button style={{ ...accentPill, marginTop: 32 }} onClick={() => setSearchOpen(true)}>Find your show</button>
          )}
          {show && (
            <div style={{ textAlign: "center", marginTop: 32, padding: "0 24px", width: "100%", boxSizing: "border-box" }}>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 28, letterSpacing: 0, color: C.cream }}>
                {show.name}
              </div>
              <div style={{ marginTop: 20, color: C.cream, fontWeight: 600, fontSize: 13, letterSpacing: -0.5 }}>
                How much have you watched?
              </div>
              <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
                <OneSelectProgress
                  show={show}
                  value={prog}
                  allowZero
                  requireConfirm={false}
                  pillBg="transparent"
                  onChangeSelected={(v) => setProg(v)}
                  onConfirm={() => {}}
                />
              </div>
              <div style={{ marginTop: 24 }}>
                <button style={bluePill} onClick={() => setStep(2)}>next</button>
              </div>
              <div style={{ marginTop: 16 }}>
                <button style={quietLink} onClick={() => { setShow(null); setSearchOpen(true); }}>pick a different show</button>
              </div>
            </div>
          )}
        </div>
        {searchOpen && (
          <MobileSearchSheet
            shows={shows}
            progress={{}}
            addLabel="next"
            onClose={() => setSearchOpen(false)}
            onAdd={(s, v) => { setShow(s); setProg(v); setSearchOpen(false); setStep(2); }}
            onCatalogAdd={(s) => setShows((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]))}
          />
        )}
      </>
    );
  }

  // ── Screen 2: the one required friend (sky; the invite sheet's language) ──
  if (step === 2) {
    return (
      <div style={{ ...fullScreen, background: C.sky }}>
        <button style={backLink} onClick={() => setStep(1)}>← back</button>
        <div style={{ width: "100%", maxWidth: 420, padding: "0 24px", boxSizing: "border-box", textAlign: "center" }}>
          <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 26, letterSpacing: 0, color: C.cream, margin: "0 0 8px" }}>
            Who&rsquo;s one friend you<br />always text about TV?
          </h1>
          <p style={{ fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, letterSpacing: "normal", color: C.cream, margin: "0 0 20px" }}>
            (You can invite more later.)
          </p>
          <input
            value={friendName}
            onChange={(e) => setFriendName(e.target.value)}
            placeholder="their name"
            maxLength={40}
            className="m-onb-input"
            style={{ ...creamInput, marginBottom: 10 }}
          />
          <input
            value={friendEmail}
            onChange={(e) => setFriendEmail(e.target.value)}
            placeholder="their email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            className="m-onb-input"
            style={{ ...creamInput, marginBottom: 20 }}
          />
          {/* Optional "hi, it's…" — the invite sheet's copy, singular. */}
          <p style={{ fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, letterSpacing: "normal", lineHeight: 1.5, color: C.cream, margin: "0 0 10px" }}>
            Your friend will get an email invite from your username. If you don&rsquo;t think they&rsquo;d recognize it, tell them who you are:
          </p>
          <input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="hi, it's…"
            maxLength={40}
            className="m-onb-input"
            style={{ ...creamInput, marginBottom: 20 }}
          />
          <button
            style={{ ...bluePill, opacity: screen2Ready && !advancing ? 1 : 0.6 }}
            disabled={!screen2Ready || advancing}
            onClick={advanceToCompose}
          >
            {advancing ? <>one moment<LoadingDots /></> : "Invite"}
          </button>
        </div>
        <style>{`.m-onb-input::placeholder { color: rgba(26,58,74,0.45); }`}</style>
      </div>
    );
  }

  // ── Screen 3: the REAL mobile compose (or the copy-link fallback panel) ──
  if (step === 3 && show) {
    if (fallbackLink) {
      return (
        <div style={{ ...fullScreen, background: C.yellow }}>
          <div style={{ width: "100%", maxWidth: 420, padding: "0 24px", boxSizing: "border-box", textAlign: "center" }}>
            <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 24, color: C.cream, marginBottom: 12 }}>Your writing is published!</div>
            <div style={{ color: C.cream, fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              But Sidebar couldn&rsquo;t email the invite to {friendName.trim() || "your friend"} right now.
              Copy the link and send it to them yourself — it works the same.
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20, background: "rgba(253,248,236,0.15)", borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ flex: 1, fontSize: 12, color: C.cream, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fallbackLink}</div>
              <button style={{ ...bluePill, padding: "8px 20px", minHeight: 36 }} onClick={copyLink}>{copied ? "copied!" : "copy"}</button>
            </div>
            <button style={bluePill} onClick={() => setStep(4)}>continue →</button>
          </div>
        </div>
      );
    }
    return (
      <div style={composeShell}>
        {/* Back replaces the compose exits (no skipping out) — routed through
            the form's discard check so typed writing still gets its confirm. */}
        <button
          style={{ ...backLink, color: C.blue, position: "fixed", zIndex: 1010 }}
          onClick={() => composeRef.current?.attemptDiscard()}
        >← back</button>
        <ComposeForm
          ref={composeRef}
          mobileIdiom
          showId={show.id}
          privateOnly
          hideTopRightClose
          hideCancel
          onCancel={() => setStep(2)}
          onSubmitted={() => {}}
          initialTitle="Let's do this!"
          headingOverride={
            <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 24, letterSpacing: 0, color: C.blue, margin: "40px 0 10px" }}>
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
    );
  }

  // ── Screen 4: confirmation, straight on the green — click-through wrapper
  //    so the top bar (logo, account, sign-out) stays visible and alive. ─────
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ textAlign: "center", maxWidth: 420, padding: "0 24px", pointerEvents: "auto" }}>
        <h1 style={{ ...onbHeading, marginBottom: 24 }}>You&rsquo;re in.</h1>
        <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "normal", lineHeight: 1.7, color: C.cream, marginBottom: 36 }}>
          You&rsquo;ve now created a show room for <b>{show?.name}</b>, invited{" "}
          <b>{friendName.trim() || "your friend"}</b>, and left them some writing to read.
          Invite more friends you want to watch with. Sidebar is for writing to your friends.
        </div>
        <button style={bluePill} onClick={() => onDone(bootRef.current.gid ?? null)}>Get started!</button>
      </div>
    </div>
  );
}

// ── Styles (canon; full-screen panels CENTER their elements) ────────────────
const fullScreen: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  paddingTop: "calc(env(safe-area-inset-top, 0px) + 24px)",
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
  boxSizing: "border-box",
};
const onbHeading: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 28, lineHeight: 1.2, letterSpacing: 0, color: CANON.cream, margin: 0,
};
const onbSubline: React.CSSProperties = {
  fontFamily: "Inter, sans-serif", fontSize: 13, color: CANON.cream, marginTop: 10,
};
const backLink: React.CSSProperties = {
  position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 14px)", left: 18,
  border: "none", background: "transparent",
  color: CANON.cream, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 8,
};
const accentPill: React.CSSProperties = {
  border: "none", background: CANON.accent, color: CANON.cream, fontWeight: 700, fontSize: 14,
  padding: "16px 48px", borderRadius: 65, cursor: "pointer", minHeight: 48,
};
const bluePill: React.CSSProperties = {
  border: "none", background: CANON.identity, color: CANON.cream, fontWeight: 700, fontSize: 14,
  padding: "14px 40px", borderRadius: 65, cursor: "pointer", minHeight: 44,
};
const quietLink: React.CSSProperties = {
  border: "none", background: "transparent", color: CANON.cream, fontSize: 13, fontWeight: 700,
  cursor: "pointer", padding: 8, opacity: 0.85,
};
const creamInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "none", borderRadius: 65,
  padding: "14px 24px", fontFamily: '"Inter", sans-serif', fontSize: 16,
  color: CANON.dark, background: CANON.cream, outline: "none", minHeight: 44,
};
// The show room's full-screen compose shell (mobile idiom of the desktop
// compose card).
const composeShell: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, background: CANON.cream, overflowY: "auto",
  WebkitOverflowScrolling: "touch",
};
