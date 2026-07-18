import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { LogOut, UserCog, MessageCircleWarning } from "lucide-react";
import { CANON } from "../styles/canon";
import { useAuth } from "../lib/auth";
import AccountModal from "../components/AccountModal";
import MobileFeedbackSheet from "./MobileFeedbackSheet";
import SidebarLogo from "../components/SidebarLogo";
import LoadingDots from "../components/LoadingDots";
import MobileInviteSheet from "./MobileInviteSheet";
import MobileSocialOnboarding from "./MobileSocialOnboarding";
import DeckWave from "../components/deck/DeckWave";
import YoureInCard from "../components/deck/YoureInCard";
import MobileDeckCard from "../components/deck/MobileDeckCard";
import {
  markSocialOnboarded,
  fetchPeopleGroupsForUser,
  fetchPeopleGroupMembers,
  fetchGroupPendingInvites,
  fetchMyPendingGroupInvites,
  acceptPeopleGroupInvite,
  declinePeopleGroupInvite,
  fetchContactNames,
  fetchMyPendingInviteNames,
  fetchRoomActivityVisibility,
  roomHasNewActivity,
  fetchGroupChatActivity,
  chatHasNewActivity,
  type PendingGroupInvite,
  type RoomVisibility,
  type GroupChatActivity,
} from "../lib/db";
import { groupDisplayName, personDisplayName, pendingInviteMemberNames, pendingInviterLabel } from "../lib/groupNames";
import type { PeopleGroup, PeopleGroupMember } from "../types";

/**
 * MobileDashboard — the signed-in home of the /m rebuild, GROUPS-ONLY since
 * the mobile mirror arc's CP2 (2026-07-07, desktop parity with the
 * social-onboarding arc): the personal shelves / personal show sheet /
 * remove-from-pool layer is GONE — a not-started show lives inside a group
 * as a proposal, so the dashboard is your groups (plus pending invites) and
 * ONE act: "Create another watch group?" (≥1 named friend + ≥1 proposed
 * show, in the invite sheet).
 *
 *   • Groups render as full-width rows with the member avatar cluster +
 *     ONE activity dot (new visible writing OR new chat — the split shows
 *     inside the group). Naming is the dual-mode model (groupNames.ts):
 *     custom name wins → else the viewer's own names for the members
 *     (phone-contacts) + their pending-invite names → else per-viewer
 *     "Group N" by the viewer's join order.
 *   • Pending group invites render as rows too; tapping opens the join
 *     sheet (the desktop hover tooltip copy moves inline — no hover here).
 */

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const C = {
  green: CANON.personal,
  sky: CANON.friend,
  blue: CANON.identity,
  yellow: CANON.accent,
  red: CANON.alert,
  cream: CANON.cream,
  midnight: CANON.dark,
};

type RailGroup = { group: PeopleGroup; members: PeopleGroupMember[]; pendingHandles: string[] };

// Last-render snapshot for instant paint (stale-while-revalidate): the
// dashboard renders this immediately on open while the live fetches run,
// so cold opens / back-swipes don't flash a bare page. Key bumped to v2 at
// the CP2 groups-only cutover so a pre-cutover snapshot (personal shelves)
// can never paint the dead layer.
const SNAP_KEY = (uid: string) => `ns_m_dash_snap2_${uid}`;

/** Format a pending invite's members as "@X and @Y" for the join prompt.
 *  (Received-invite surfaces keep @handles — naming-the-inviter deferred.) */
function inviteNames(inv: PendingGroupInvite, contactNames: Record<string, string>): string {
  const ns = pendingInviteMemberNames(inv, contactNames);
  if (ns.length === 1) return ns[0];
  if (ns.length === 2) return `${ns[0]} and ${ns[1]}`;
  return `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}

export default function MobileDashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const selfUserId = user?.id ?? "";

  const [railGroups, setRailGroups] = useState<RailGroup[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingGroupInvite[]>([]);
  const [contactNames, setContactNames] = useState<Record<string, string>>({});
  const [pendingInviteNames, setPendingInviteNames] = useState<Record<string, string[]>>({});
  const [roomVis, setRoomVis] = useState<RoomVisibility[]>([]);
  const [chatActivity, setChatActivity] = useState<GroupChatActivity[]>([]);
  const [loading, setLoading] = useState(true);

  // CP3 social onboarding (3-screen show→friend→seed-entry flow). Fires ONCE
  // for brand-new self-signup accounts (no TSP demo on mobile per Alborz):
  // invited accounts (already in a group) are stamped as done without ever
  // seeing it, and an account with a pending invite waits (they may accept;
  // re-evaluated next visit). Force-show for testing with ?sonb=1 (no stamp).
  const forceSocialOnb = new URLSearchParams(window.location.search).get("sonb") === "1";
  const [showSocialOnb, setShowSocialOnb] = useState(false);
  // Swipe-deck arc CP4: the drip modal waits for this gate to RESOLVE so it
  // can never race the onboarding waves (waves take precedence). A pending
  // invite leaves it unresolved — the accept flow owns that user's cards.
  const [onbResolved, setOnbResolved] = useState(false);
  useEffect(() => {
    if (authLoading || !user) return;
    if (forceSocialOnb) { setShowSocialOnb(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const [groups, invites] = await Promise.all([
          fetchPeopleGroupsForUser(user.id).catch(() => []),
          fetchMyPendingGroupInvites().catch(() => []),
        ]);
        if (cancelled) return;
        // Onboarding fires whenever you have NO groups and NO pending invites
        // — brand-new self-signups AND a returning user who has LEFT all their
        // groups (guide them back; Alborz 2026-07-08). Pending invite → accept
        // first; any group stamps done + skips. The onboarded flag no longer
        // suppresses it (a reset should re-guide). No TSP demo on mobile.
        if (invites.length > 0) return;
        if (groups.length > 0) { markSocialOnboarded(user.id).catch(() => {}); setOnbResolved(true); return; }
        setShowSocialOnb(true);
        setOnbResolved(true);
      } catch { /* tolerant — never block the dashboard */ }
    })();
    return () => { cancelled = true; };
  }, [user, authLoading, forceSocialOnb]);
  async function handleSocialOnbDone(_groupId: string | null) {
    setShowSocialOnb(false);
    if (!forceSocialOnb && user) markSocialOnboarded(user.id).catch(() => {});
    await refreshRailAndInvites();
    // Swipe-deck arc CP2 (spec §12.1): onboarding lands on the DASHBOARD —
    // the new group's row is waiting there (was: straight into the group).
  }

  // Sheets
  const [invitePrompt, setInvitePrompt] = useState<PendingGroupInvite | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  // Swipe-deck arc CP2 (spec §12.2): accepting an invite runs WAVE 1 → the
  // "You're in!" invitee card → rests on the dashboard (wave 2 fires on the
  // first click into the group room). Both self-skip once answered.
  const [postAccept, setPostAccept] = useState<PendingGroupInvite | null>(null);
  const [postAcceptPhase, setPostAcceptPhase] = useState<"wave" | "card">("wave");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // ── Loads (same calls + tolerance as desktop DashboardPage) ──────────────
  const loadRail = useCallback(async (uid: string): Promise<RailGroup[]> => {
    try {
      const groups = await fetchPeopleGroupsForUser(uid);
      return await Promise.all(
        groups.map(async (g) => ({
          group: g,
          members: await fetchPeopleGroupMembers(g.id),
          pendingHandles: await fetchGroupPendingInvites(g.id),
        }))
      );
    } catch (e) {
      console.warn("[m-dashboard] people-groups not loaded", e);
      return [];
    }
  }, []);

  // One-time-per-mount snapshot hydration guard.
  const hydratedRef = React.useRef(false);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    // Instant paint: hydrate from the last visit's snapshot (if any) before
    // the live fetches — the page renders real content immediately and the
    // fresh data replaces it when it lands. Display-only staleness; every
    // write path still goes through the live DB calls.
    let snapshotUsed = false;
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      try {
        const raw = sessionStorage.getItem(SNAP_KEY(user.id));
        if (raw) {
          const s = JSON.parse(raw);
          setRailGroups(s.railGroups ?? []);
          setPendingInvites(s.pendingInvites ?? []);
          setContactNames(s.contactNames ?? {});
          setPendingInviteNames(s.pendingInviteNames ?? {});
          setLoading(false);
          snapshotUsed = true;
        }
      } catch { /* corrupt/absent snapshot → normal load */ }
    }
    (async () => {
      if (!snapshotUsed) setLoading(true);
      try {
        const rail = await loadRail(user.id);
        if (!cancelled) setRailGroups(rail);
      } catch (e) {
        console.error("[m-dashboard] rail load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
      // Secondary data — concurrent, independently tolerant (desktop parity).
      fetchMyPendingGroupInvites()
        .then((inv) => { if (!cancelled) setPendingInvites(inv); })
        .catch((e) => console.warn("[m-dashboard] pending invites not loaded", e));
      // Contact names + own-pending-invite names (both small owner-scoped
      // reads; tolerant pre-migration → {}).
      Promise.all([fetchContactNames(user.id), fetchMyPendingInviteNames(user.id)])
        .then(([cn, pn]) => { if (!cancelled) { setContactNames(cn); setPendingInviteNames(pn); } })
        .catch(() => { /* tolerant */ });
      Promise.all([
        fetchRoomActivityVisibility(user.id, true),
        fetchGroupChatActivity(user.id),
      ])
        .then(([rv, ca]) => { if (!cancelled) { setRoomVis(rv); setChatActivity(ca); } })
        .catch((e) => console.warn("[m-dashboard] activity dots not loaded", e));
    })();
    return () => { cancelled = true; };
  }, [user, authLoading, loadRail]);

  // Keep the instant-paint snapshot current.
  useEffect(() => {
    if (loading || !user) return;
    try {
      sessionStorage.setItem(SNAP_KEY(user.id), JSON.stringify({
        railGroups,
        pendingInvites,
        contactNames,
        pendingInviteNames,
      }));
    } catch { /* quota/private mode — instant paint just won't happen */ }
  }, [loading, user, railGroups, pendingInvites, contactNames, pendingInviteNames]);

  // Per-viewer "Group N": the viewer's Nth group by THEIR join order —
  // viewer-specific like every other part of the naming model, so the rail
  // can never hold two "Group 1"s (the old per-creator seq could collide).
  const groupNumberById = useMemo(() => {
    const withJoin = railGroups.map((r) => ({
      id: r.group.id,
      joinedAt: r.members.find((m) => m.userId === selfUserId)?.joinedAt ?? 0,
    }));
    withJoin.sort((a, b) => (a.joinedAt - b.joinedAt));
    const m: Record<string, number> = {};
    withJoin.forEach((g, i) => { m[g.id] = i + 1; });
    return m;
  }, [railGroups, selfUserId]);

  // ── Per-group activity indicator — VISIBLE writing only (spec cut: no red
  //    invisible-writing layer on mobile). ───────────────────────────────────
  const writingNewByGroup = useMemo(() => {
    const s = new Set<string>();
    for (const v of roomVis) {
      if (v.parentGroupId && roomHasNewActivity(v)) s.add(v.parentGroupId);
    }
    return s;
  }, [roomVis]);
  const chatNewByGroup = useMemo(() => {
    const s = new Set<string>();
    for (const a of chatActivity) if (chatHasNewActivity(a)) s.add(a.groupId);
    return s;
  }, [chatActivity]);

  async function refreshRailAndInvites() {
    if (!user) return;
    try { setRailGroups(await loadRail(user.id)); } catch { /* tolerant */ }
    try { setPendingInvites(await fetchMyPendingGroupInvites()); } catch { /* tolerant */ }
    try {
      const [cn, pn] = await Promise.all([fetchContactNames(user.id), fetchMyPendingInviteNames(user.id)]);
      setContactNames(cn); setPendingInviteNames(pn);
    } catch { /* tolerant */ }
  }

  async function acceptInvite(inv: PendingGroupInvite) {
    const res = await acceptPeopleGroupInvite(inv.token);
    if (res.ok) {
      setInvitePrompt(null);
      setAcceptError(null);
      await refreshRailAndInvites();
      // Swipe-deck arc CP2: wave 1 → "You're in!" card → rest on the
      // dashboard (was: straight into the group; spec §12.2 lands here).
      setPostAcceptPhase("wave");
      setPostAccept(inv);
      return;
    }
    console.error("[m-dashboard] accept invite failed", res.error);
    setAcceptError(
      res.error === "wrong_recipient"
        ? "This invite was sent to a different email than the one you're signed in with."
        : res.error === "group_full"
        ? "This group is full (8 members max)."
        : res.error === "expired"
        ? "This invitation has expired — ask your friend to invite you again."
        : "Couldn't join. Ask your friend to invite you again.",
    );
  }

  async function declineInvite(inv: PendingGroupInvite) {
    setInvitePrompt(null);
    setPendingInvites((prev) => prev.filter((p) => p.token !== inv.token));
    await declinePeopleGroupInvite(inv.token);
    await refreshRailAndInvites();
  }

  // ── Guards ─────────────────────────────────────────────────────────────────
  // While the session restores, paint the page chrome instead of a blank
  // screen (the blank was the "feels broken" moment on cold opens).
  if (authLoading) {
    return (
      <div style={page}>
        <div style={topBar}>
          <SidebarLogo scale={0.5} blocksOpacity={1} bg="green" />
        </div>
        <div style={{ textAlign: "center", padding: 48, color: C.cream, fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14 }}>loading<LoadingDots /></div>
      </div>
    );
  }
  if (!user) return <Navigate to="/m" replace />;

  return (
    <div style={page}>
      {/* ── Top bar: logo (home) · feedback · account · sign-out ── */}
      <div style={topBar}>
        <div onClick={() => navigate("/m/dashboard")} role="button" aria-label="Home" style={{ cursor: "pointer" }}>
          <SidebarLogo scale={0.5} blocksOpacity={1} bg="green" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button style={topCircleBtn} title="feedback" onClick={() => setFeedbackOpen(true)}>
            <MessageCircleWarning size={18} color={C.cream} />
          </button>
          <button style={topCircleBtn} title="account" onClick={() => setShowAccount(true)}>
            <UserCog size={18} color={C.cream} />
          </button>
          <button
            style={topCircleBtn}
            title="sign out"
            onClick={async () => { try { await signOut?.(); } catch { /* ignore */ } navigate("/m", { replace: true }); }}
          >
            <LogOut size={18} color={C.cream} />
          </button>
        </div>
      </div>

      {showAccount && <AccountModal onClose={() => setShowAccount(false)} />}
      {feedbackOpen && <MobileFeedbackSheet onClose={() => setFeedbackOpen(false)} />}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.cream, fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14 }}>loading<LoadingDots /></div>
      ) : (
        <>
          {/* ── Groups + pending invites ── */}
          {(railGroups.length > 0 || pendingInvites.length > 0) && (
            <div style={groupsWrap}>
              {railGroups.map(({ group, members, pendingHandles }) => {
                const others = members.filter((m) => m.userId !== selfUserId);
                // ONE dot per group row: new visible writing OR new chat (the
                // split shows up inside the group — show-row dots vs the chat
                // toggle's dot). Per Alborz 2026-07-02: no separate chat icon here.
                const anyNew = writingNewByGroup.has(group.id) || chatNewByGroup.has(group.id);
                return (
                  <button key={group.id} style={groupRow} onClick={() => navigate(`/m/group/${group.id}`)}>
                    <span style={avatarStrip}>
                      {others.map((m) => (
                        <span key={m.userId} style={{ ...avatarCircle, background: C.cream, color: C.green }}>
                          {(personDisplayName(contactNames, m.userId, m.username, m.displayName)[0] ?? "?").toUpperCase()}
                        </span>
                      ))}
                      {pendingHandles.map((h, i) => (
                        <span key={`p${i}`} style={{ ...avatarCircle, background: C.yellow, color: C.cream }}>
                          {(h[0] ?? "?").toUpperCase()}
                        </span>
                      ))}
                    </span>
                    <span style={groupRowName}>
                      {groupDisplayName(group, others, contactNames, pendingInviteNames[group.id] ?? [], groupNumberById[group.id])}
                    </span>
                    {anyNew && <span style={writingDot} />}
                  </button>
                );
              })}
              {pendingInvites.map((inv) => {
                const names = pendingInviteMemberNames(inv, contactNames);
                const label = inv.groupName || names.join(", ");
                return (
                  <button key={inv.token} style={groupRow} onClick={() => { setInvitePrompt(inv); setAcceptError(null); }}>
                    <span style={avatarStrip}>
                      {names.map((n, i) => (
                        <span key={i} style={{ ...avatarCircle, background: C.red, color: C.cream }}>
                          {(n[0] ?? "?").toUpperCase()}
                        </span>
                      ))}
                    </span>
                    <span style={groupRowName}>{label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── The dashboard's ONE act (CP2): create a new group by pairing
                 ≥1 named friend with ≥1 proposed show (desktop copy). Hidden
                 while onboarding is up — its screens own the page and this
                 reads as a competing action. ── */}
          {!showSocialOnb && (
            <div style={{ textAlign: "center", padding: "16px 16px 24px" }}>
              <button style={invitePill} onClick={() => setInviteOpen(true)}>Create another watch group?</button>
            </div>
          )}
        </>
      )}

      {/* ── Pending-invite join prompt (bottom sheet; desktop copy + the
             hover tooltip line moved inline) ── */}
      {invitePrompt && (
        <div style={dim} onClick={(e) => { if (e.target === e.currentTarget) { setInvitePrompt(null); setAcceptError(null); } }}>
          {/* Bottom-sheet rule (2026-07-03): left-justify. */}
          <div style={{ ...bottomSheet, background: C.yellow }}>
            <div style={{ color: C.cream, fontSize: 13, fontWeight: 600, marginBottom: 10, opacity: 0.9 }}>
              You&rsquo;ve been invited by {pendingInviterLabel(invitePrompt, contactNames)} to join a watch group.
            </div>
            <div style={{ ...sheetTitle, textAlign: "left" }}>Join a group with {inviteNames(invitePrompt, contactNames)}?</div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-start", marginTop: 16 }}>
              <button style={startBtn} onClick={() => acceptInvite(invitePrompt)}>Yes</button>
              <button style={{ ...startBtn, background: "transparent", color: C.cream, border: `2px solid ${C.cream}` }} onClick={() => declineInvite(invitePrompt)}>no</button>
            </div>
            {acceptError && (
              <div style={{ marginTop: 14, textAlign: "left", color: C.cream, fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{acceptError}</div>
            )}
          </div>
        </div>
      )}

      {/* ── Invite compose (full-screen; creates a new group). Closing after
             a create lands INSIDE the new group (desktop parity). ── */}
      {inviteOpen && (
        <MobileInviteSheet
          onClose={() => setInviteOpen(false)}
          onSent={() => { refreshRailAndInvites(); }}
          onCreated={(groupId) => { setInviteOpen(false); navigate(`/m/group/${groupId}`); }}
        />
      )}

      {/* ── CP3: the 3-screen first-run flow (over the plain green). Now
             opens with WAVE 1 and closes with WAVE 2 + the "You're in!" card
             (swipe-deck arc CP2). ── */}
      {showSocialOnb && <MobileSocialOnboarding onDone={handleSocialOnbDone} />}

      {/* ── Swipe-deck arc CP2 — invitee accept sequence: wave 1 → "You're
             in!" card, then rest on the dashboard. ── */}
      {postAccept && postAcceptPhase === "wave" && (
        <DeckWave wave={1} heading="welcome" idiom="mobile" onComplete={() => setPostAcceptPhase("card")} />
      )}
      {postAccept && postAcceptPhase === "card" && (
        <YoureInCard
          idiom="mobile"
          variant={{ kind: "invitee", friendName: postAccept.inviterDisplayName || postAccept.inviterName }}
          onDone={() => setPostAccept(null)}
        />
      )}

      {/* ── Swipe-deck arc CP3b — the docked "How I Watch TV" card (answers-
             led artifact leads; grid behind the tap). Self-hiding until the
             user has answers; hidden while a first-run overlay owns the
             page. ── */}
      {user && !showSocialOnb && !postAccept && (
        <MobileDeckCard mode="personal" viewerId={user.id} />
      )}

      {/* ── Swipe-deck arc CP4 — the drip / catch-up modal: up to 4 released,
             unanswered cards, once per session; waits for the onboarding
             gate (waves take precedence). ── */}
      {user && onbResolved && !showSocialOnb && !postAccept && (
        <DeckWave wave="drip" heading="none" idiom="mobile" onComplete={() => {}} />
      )}
    </div>
  );
}

// ── Styles (canon tokens; §16 type; 44px targets; 100dvh + safe areas) ──────
const page: React.CSSProperties = {
  minHeight: "100dvh",
  boxSizing: "border-box",
  background: "var(--dos-bg, var(--canon-personal,#7abd8e))",
  fontFamily: '"Inter", system-ui, sans-serif',
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)",
};
const topBar: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "calc(env(safe-area-inset-top, 0px) + 12px) 16px 8px",
};
const topCircleBtn: React.CSSProperties = {
  width: 44, height: 44, borderRadius: "50%", background: "transparent",
  border: `2px solid ${C.cream}`, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const groupsWrap: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 12, padding: "8px 16px 24px",
};
const groupRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  width: "100%", minHeight: 64, padding: "10px 16px", boxSizing: "border-box",
  borderRadius: 20, border: `2px solid ${C.cream}`, background: "transparent",
  cursor: "pointer", textAlign: "left",
};
const avatarStrip: React.CSSProperties = { display: "inline-flex", flexShrink: 0 };
const avatarCircle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: "50%",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  fontFamily: LORA, fontWeight: 700, fontSize: 22, letterSpacing: 0,
  marginRight: -8, border: `2px solid ${CANON.personal}`, boxSizing: "border-box",
};
const groupRowName: React.CSSProperties = {
  flex: 1, marginLeft: 8, fontWeight: 700, fontSize: 15, letterSpacing: -0.5,
  color: C.cream, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};
const writingDot: React.CSSProperties = {
  width: 14, height: 14, borderRadius: "50%", background: C.blue, display: "inline-block", flexShrink: 0,
};
const invitePill: React.CSSProperties = {
  border: "none", background: C.blue, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "16px 40px", borderRadius: 65, cursor: "pointer", minHeight: 48,
  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};
const sheetTitle: React.CSSProperties = {
  color: C.cream, fontSize: 15, fontWeight: 600, letterSpacing: -0.5, textAlign: "center",
};
// Bottom sheet (mobile idiom for small confirm cards).
const dim: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, background: "rgba(26,58,74,0.35)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
};
const bottomSheet: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: C.sky,
  borderTopLeftRadius: 24, borderTopRightRadius: 24,
  padding: "26px 24px calc(env(safe-area-inset-bottom, 0px) + 26px)",
};
const startBtn: React.CSSProperties = {
  border: "none", background: C.blue, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "11px 38px", borderRadius: 65, cursor: "pointer", minHeight: 44,
};
