import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { CANON } from "../styles/canon";
import SidebarLogo from "../components/SidebarLogo";
import DeckWave from "../components/deck/DeckWave";
import YoureInCard from "../components/deck/YoureInCard";
import { preventLastWordOrphan } from "../lib/utils";
import {
  getPeopleGroupInvite, acceptPeopleGroupInvite, declinePeopleGroupInvite,
  fetchShows, fetchPublicProfileByUsername, fetchPublicProgressForUser,
  fetchPublicPool, type PublicPoolShow,
  type GroupInviteInfo, type Show,
} from "../lib/db";
import type { ProgressEntry } from "../types";

/**
 * MobileGroupInviteAccept (CP7b) — the invite email opened on a phone.
 * Mobile re-expression of the desktop GroupInviteAcceptPage, as a linear
 * full-screen flow (per spec):
 *
 *   logged-out → welcome: the inviter's watch pool ("@X wants to watch…" /
 *   "…is already watching…", same copy + data calls as the desktop invite
 *   arrival) + JOIN IN → /m/auth prefilled from the invite (mode by
 *   inviteeHasAccount, email locked, hint line, returnTo back HERE so both
 *   the sign-in path and the email-confirmation link land on the join
 *   confirm — the mobile idiom of desktop's postSignin/entering phases).
 *
 *   signed-in → "Join a group with @X?" Yes/no (Yes joins → /m/dashboard;
 *   no fully DECLINES the invite, same as desktop). Wrong-recipient /
 *   already-used / expired / invalid states carry desktop copy.
 */

const C = { green: CANON.personal, blue: CANON.identity, yellow: CANON.accent, red: CANON.alert, cream: CANON.cream, midnight: CANON.dark };
const LORA = '"Lora", Georgia, serif';

type Status = "loading" | "ready" | "invalid" | "expired" | "already" | "wrong" | "joining" | "done" | "error";

export default function MobileGroupInviteAccept({ token }: { token: string }) {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<GroupInviteInfo | null>(null);
  const [masked, setMasked] = useState<string | undefined>();
  const [detail, setDetail] = useState<string>("");

  // Inviter's public pool for the logged-out welcome (same calls as the
  // desktop arrival's PublicDashboardPage).
  const [poolShows, setPoolShows] = useState<Show[]>([]);
  const [poolProgress, setPoolProgress] = useState<Record<string, ProgressEntry>>({});
  // Opt-in-based shelves (2026-07-07): proposals + open rooms from the new
  // RPC; null pre-migration → the old progress-derived split below.
  const [pool, setPool] = useState<{ proposals: PublicPoolShow[]; rooms: PublicPoolShow[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getPeopleGroupInvite(token);
      if (cancelled) return;
      if (!res.ok) {
        console.error("[m-group-invite] lookup failed", { token, error: res.error });
        setDetail(`token=${token} · ${res.error}`);
        setStatus(res.error === "expired" ? "expired" : res.error === "already_accepted" ? "already" : "invalid");
        return;
      }
      setInfo(res.info);
      setStatus("ready");
      // Load the inviter's pool for the welcome shelves (tolerant).
      try {
        const prof = await fetchPublicProfileByUsername(res.info.inviterName);
        if (!prof || cancelled) return;
        const [allShows, prog, pp] = await Promise.all([
          fetchShows(), fetchPublicProgressForUser(prof.id), fetchPublicPool(prof.id),
        ]);
        if (cancelled) return;
        setPoolShows(allShows);
        setPoolProgress(prog);
        setPool(pp);
      } catch { /* welcome degrades to headings + JOIN IN */ }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const showsById = useMemo(() => {
    const m: Record<string, Show> = {};
    for (const s of poolShows) m[s.id] = s;
    return m;
  }, [poolShows]);

  // Opt-in-based shelves (2026-07-07, desktop parity): interested = live
  // yes-votes anywhere (minus left rooms); watching = open rooms they're in.
  // Pre-migration fallback: the old progress-derived split.
  const { watching, interested } = useMemo(() => {
    const byName = (a: { show: Show }, b: { show: Show }) => a.show.name.localeCompare(b.show.name);
    if (pool) {
      const map = (rows: PublicPoolShow[]) => rows
        .map((r) => ({ show: showsById[r.showId], entry: { s: r.s, e: r.e } as ProgressEntry }))
        .filter((x): x is { show: Show; entry: ProgressEntry } => !!x.show && !x.show.isHidden)
        .sort(byName);
      // s0e0 room shows (haven't started) belong on the "interested in
      // starting" shelf, not "already watching" (Alborz 2026-07-08).
      const started = (r: PublicPoolShow) => (r.s ?? 0) > 0 || (r.e ?? 0) > 0;
      return {
        watching: map(pool.rooms.filter(started)),
        interested: map([...pool.proposals, ...pool.rooms.filter((r) => !started(r))]),
      };
    }
    const w: { show: Show; entry: ProgressEntry }[] = [];
    const n: { show: Show; entry: ProgressEntry }[] = [];
    for (const [showId, entry] of Object.entries(poolProgress)) {
      const show = showsById[showId];
      if (!show || show.isHidden) continue;
      if (entry.stoppedWatching) continue;
      const started = (entry.s ?? 0) > 0 || (entry.e ?? 0) > 0;
      (started ? w : n).push({ show, entry });
    }
    return { watching: w.sort(byName), interested: n.sort(byName) };
  }, [pool, poolProgress, showsById]);

  // Reworked in QA 2026-07-18: the "You're in!" invitee card IS the accept
  // confirmation (replaces the old Yes/no). GET STARTED! accepts → WAVE 1
  // (self-skipping) → straight into the group room. The decline path lost
  // its surface with the Yes/no — flagged.
  async function join() {
    setStatus("joining");
    const res = await acceptPeopleGroupInvite(token);
    if (res.ok) { setStatus("done"); return; }
    if (res.error === "wrong_recipient") { setMasked(res.maskedEmail); setStatus("wrong"); return; }
    if (res.error === "already_accepted") { setStatus("already"); return; }
    if (res.error === "expired") { setStatus("expired"); return; }
    setStatus("error");
  }

  function goAuth() {
    if (!info) return;
    const q = new URLSearchParams();
    q.set("mode", info.inviteeHasAccount ? "signin" : "signup");
    q.set("returnTo", `/m/group-invite/${token}`);
    if (info.inviteeEmail) { q.set("email", info.inviteeEmail); q.set("lock", "1"); }
    // Typed name only (no @handle, no parens) throughout onboarding.
    const inviterLabel = info.inviterDisplayName || `@${info.inviterName}`;
    q.set("hint", info.inviteeHasAccount
      ? `Sign in to watch shows with ${inviterLabel} on Sidebar.`
      : `Create your account to watch shows with ${inviterLabel} on Sidebar.`);
    navigate(`/m/auth?${q.toString()}`);
  }

  // How the inviter is shown to the invitee throughout onboarding: their
  // first name (inviter_display_name, auto-filled from the inviter's profile
  // at email time since CP4); else the handle (email leg never ran).
  const inviterShown = info?.inviterDisplayName || `@${info?.inviterName ?? "someone"}`;
  // "Join a group with …?" — inviter as their typed name; other members keep
  // their @handle (no typed name to show for them).
  const others = info ? info.memberNames.filter((n) => n) : [];
  const memberLabels = others.map((n) => (n === info?.inviterName && info?.inviterDisplayName ? info.inviterDisplayName : `@${n}`));
  const names = memberLabels.length
    ? memberLabels.reduce((acc, n, i, arr) => (i === 0 ? n : i === arr.length - 1 ? `${acc} and ${n}` : `${acc}, ${n}`), "")
    : inviterShown;

  // ── The signed-in confirm — the "You're in!" card (GET STARTED! = accept) ─
  if ((status === "ready" || status === "joining") && user && info) {
    return (
      <div style={page}>
        <div style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 12px)", left: 16 }}>
          <SidebarLogo scale={0.5} blocksOpacity={1} />
        </div>
        <YoureInCard
          idiom="mobile"
          variant={{ kind: "invitee", friendName: info.inviterDisplayName || info.inviterName }}
          busy={status === "joining"}
          onDone={join}
        />
      </div>
    );
  }

  // ── Joined: wave 1 over the plain green → straight into the group room ────
  if (status === "done") {
    return (
      <div style={page}>
        <div style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 12px)", left: 16 }}>
          <SidebarLogo scale={0.5} blocksOpacity={1} />
        </div>
        <DeckWave
          wave={1}
          heading="welcome"
          idiom="mobile"
          onComplete={() => navigate(info ? `/m/group/${info.groupId}` : "/m/dashboard", { replace: true })}
        />
      </div>
    );
  }

  // ── Logged-out welcome: inviter's pool + JOIN IN (single column) ──────────
  if (status === "ready" && info && !user && !authLoading) {
    return (
      <div style={welcomePage}>
        <div style={{ padding: "calc(env(safe-area-inset-top, 0px) + 12px) 16px 8px" }}>
          <SidebarLogo scale={0.5} blocksOpacity={1} />
        </div>
        <div style={{ padding: "8px 16px 48px" }}>
          {/* Same shelf copy as desktop + /pool (2026-07-07): interested-in-
              starting (opted-in proposals) first, open-room shows second. */}
          {interested.length > 0 && (
            <>
              <h2 style={inviteHeading}><span style={{ color: C.cream }}>{inviterShown}</span> is interested in starting these shows:</h2>
              <div style={shelfCol}>
                {interested.map(({ show }) => (
                  <div key={show.id} style={{ ...pill, background: C.cream, color: C.green }}><span style={pillName}>{show.name}</span></div>
                ))}
              </div>
            </>
          )}
          {watching.length > 0 && (
            <>
              <h2 style={{ ...inviteHeading, marginTop: interested.length ? 40 : 0 }}>
                {interested.length > 0
                  ? "and is already watching these:"
                  : <><span style={{ color: C.cream }}>{inviterShown}</span> is already watching these shows:</>}
              </h2>
              <div style={shelfCol}>
                {watching.map(({ show, entry }) => (
                  <div key={show.id} style={{ ...pill, background: "transparent", border: `2px solid ${C.cream}`, color: C.cream }}>
                    <span style={pillName}>{show.name}</span>
                    <span style={{ fontWeight: 500 }}>s{entry.s} e{entry.e}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div style={{ textAlign: "center", marginTop: 56 }}>
            <h2 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 24, color: C.cream, margin: "0 0 4px" }}>Want to watch something with them?</h2>
            <div style={{ color: C.cream, fontSize: 15, marginBottom: 24 }}>(or propose something else?)</div>
            <button style={joinPill} onClick={goAuth}>JOIN IN</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Everything else: centered card states (desktop copy) ──────────────────
  return (
    <div style={page}>
      <div style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 12px)", left: 16 }}>
        <SidebarLogo scale={0.5} blocksOpacity={1} />
      </div>
      <div style={card}>
        {status === "loading" && <p style={muted}>Loading…</p>}

        {/* (Signed-in ready/joining renders the "You're in!" card above.) */}
        {/* Session still resolving after returning from /m/auth. */}
        {status === "ready" && !user && authLoading && <p style={muted}>Signing you in…</p>}
        {status === "wrong" && (
          <>
            <p style={title}>{preventLastWordOrphan("This invite was sent to a different email.")}</p>
            <p style={muted}>It's addressed to {masked}. {preventLastWordOrphan("Sign in with that email to join.")}</p>
          </>
        )}
        {status === "already" && (
          <>
            <p style={title}>This invite was already used.</p>
            <button style={ghost} onClick={() => navigate("/m/dashboard")}>Go to dashboard</button>
          </>
        )}
        {status === "expired" && <p style={title}>This invitation has expired.</p>}
        {status === "invalid" && (
          <>
            <p style={title}>{preventLastWordOrphan("This invitation link isn't valid.")}</p>
            <p style={muted}>{preventLastWordOrphan("This link is no longer active. The invite may have been canceled, or the link is incomplete — ask your friend to send you a new one.")}</p>
          </>
        )}
        {status === "error" && <p style={title}>Something went wrong. Try the link again.</p>}
        {detail && (status === "error" || status === "expired" || status === "already") && (
          <p style={{ ...muted, fontSize: 11, wordBreak: "break-all", opacity: 0.7 }}>{detail}</p>
        )}
      </div>
    </div>
  );
}

const welcomePage: React.CSSProperties = {
  minHeight: "100dvh", boxSizing: "border-box", background: C.green,
  fontFamily: '"Inter", system-ui, sans-serif',
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
};
const page: React.CSSProperties = {
  position: "fixed", inset: 0, background: C.green, fontFamily: '"Inter", system-ui, sans-serif',
  display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
};
const card: React.CSSProperties = {
  background: C.yellow, borderRadius: 15, padding: "32px 28px", width: "min(420px, 92vw)", textAlign: "center",
};
const title: React.CSSProperties = { fontFamily: LORA, fontWeight: 700, fontSize: 22, letterSpacing: -1, color: C.cream, margin: "0 0 8px" };
const muted: React.CSSProperties = { color: C.midnight, fontSize: 13, margin: "8px 0 0" };
const yes: React.CSSProperties = { border: "none", background: C.blue, color: C.cream, fontWeight: 700, fontSize: 14, padding: "11px 38px", borderRadius: 65, cursor: "pointer", minHeight: 44 };
const no: React.CSSProperties = { border: `2px solid ${C.cream}`, background: "transparent", color: C.cream, fontWeight: 700, fontSize: 14, padding: "10px 30px", borderRadius: 65, cursor: "pointer", minHeight: 44 };
const ghost: React.CSSProperties = { border: `2px solid ${C.cream}`, background: "transparent", color: C.cream, fontWeight: 700, fontSize: 14, padding: "10px 28px", borderRadius: 65, cursor: "pointer", marginTop: 14, minHeight: 44 };
const inviteHeading: React.CSSProperties = {
  // All-cream (was identity blue) per 2026-07-03 QA note.
  fontFamily: LORA, fontWeight: 700, fontSize: 22, letterSpacing: 0, color: C.cream,
  textAlign: "center", margin: "16px 0 16px",
};
const shelfCol: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const pill: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 12, padding: "14px 24px", borderRadius: 65,
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14,
  letterSpacing: -1, width: "100%", boxSizing: "border-box", minHeight: 48,
};
const pillName: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const joinPill: React.CSSProperties = {
  border: "none", background: C.blue, color: C.cream, fontWeight: 800, fontSize: 20,
  padding: "18px 72px", borderRadius: 65, cursor: "pointer", minHeight: 56,
  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};
