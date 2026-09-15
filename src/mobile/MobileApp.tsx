import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { CANON, withAlpha } from "../styles/canon";
import MobileNarrative from "./MobileNarrative";
import MobileAuth from "./MobileAuth";
import MobileDashboard from "./MobileDashboard";
import MobileGroupRoom from "./MobileGroupRoom";
import MobileGroupChat from "./MobileGroupChat";
import MobileShowRoom from "./MobileShowRoom";
import MobileGroupInviteAccept from "./MobileGroupInviteAccept";
import MobilePool from "./MobilePool";

// Mobile entry point. Mounts on any path under /m/* via the top-level <App>
// router in src/App.tsx. Only admins can reach /m while the mobile rebuild is
// in progress — the mobile lockout gate in App.tsx sits ABOVE the /m route and
// shows non-admin phone visitors the MobileLockout screen on every path.
//
// CP0 (rebuild ground-clearing): the pre-restructure interior screens
// (MobileRooms / MobileRoom / MobileThread / MobileRespond / MobileCompose /
// MobileEdit* / MobileProgressGate / MobileInvite / MobileInviteAccept /
// MobileRoomMenu / MobileShowSearch) encoded the retired three-layer world
// (journal / friend-rooms-as-diaries / opt-in public) and were DELETED, not
// ported. The new interior is rebuilt checkpoint by checkpoint against the
// restructured world (dashboard → group room → show room → thread) per
// docs' mobile rebuild spec. Salvaged: MobileNarrative (homepage shell) and
// MobileAuth (linear auth flow — model-agnostic).
//
// Sub-routes (parsed off the /m prefix):
//   /m            → narrative + sign-in CTA (signed out)
//                   | redirect to /m/dashboard (signed in)
//   /m/auth       → full-screen sign-in / create-account
//                   (?returnTo= supported, validated to /m/* paths)
//   /m/dashboard              → signed-in home (CP3)
//   /m/group/:id              → group room (CP4)
//   /m/group/:id/chat         → group chat (CP5)
//   /m/show-room/private/:sid → private-only standalone writing (CP6)
//   /m/show-room/:roomId      → show room, ?entry= deep-links (CP6)
//   anything else             → narrative (unknown/retired paths fall through)
//
// Auto-redirect rule: signed-in users on bare /m get bounced to /m/dashboard
// so they don't have to scroll past the narrative pitch every time. Mirrors
// the desktop rule for signed-in non-admins on / → /dashboard.

// Mobile-scoped shared CSS, injected once into document.head the first time
// MobileApp mounts; idempotent via the element id check. Scoped two ways so
// nothing bleeds into desktop: class-scoped (.m-input) or [data-m]-scoped —
// MobileApp stamps `data-m` on <body> while mounted (same pattern as the
// body-class contexts in theme.ts).
//
// 2026-09 mobile-polish rules:
//  - one press feedback for every /m button (instant, no transition) — except
//    plated rows, whose .sb-press drop (theme.ts) is restored at higher
//    specificity so the plate behavior stays byte-identical;
//  - no iOS gray tap flash anywhere on /m;
//  - one placeholder color for cream fields. .m-input fields (translucent
//    auth fields, colored legacy fields) keep their cream placeholder until
//    each converts to a cream pill and drops the class.
function injectMobileStyles() {
  if (typeof document === "undefined") return;
  const id = "mobile-input-placeholder";
  if (document.getElementById(id)) return;
  const styleEl = document.createElement("style");
  styleEl.id = id;
  styleEl.textContent = [
    `.m-input::placeholder { color: rgba(253,248,236,0.55); }`,
    `[data-m] button:active { transform: translateY(1px); opacity: .9; }`,
    `[data-m] .sb-press > button:active { transform: translate(-2px,6px); opacity: 1; }`,
    `[data-m] button, [data-m] a { -webkit-tap-highlight-color: transparent; }`,
    `[data-m] input:not(.m-input)::placeholder { color: ${withAlpha(CANON.dark, 0.45)}; }`,
  ].join("\n");
  document.head.appendChild(styleEl);
}

export default function MobileApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    injectMobileStyles();
    // Scope the shared [data-m] rules above to the /m surface for as long as
    // any mobile page is mounted (covers portaled sheets/dialogs too).
    document.body.setAttribute("data-m", "");
    return () => { document.body.removeAttribute("data-m"); };
  }, []);

  const subPath = location.pathname.replace(/^\/m/, "") || "/";
  const subParts = subPath.split("/").filter(Boolean);

  useEffect(() => {
    if (authLoading) return;
    if (user && subPath === "/") navigate("/m/dashboard", { replace: true });
  }, [user, authLoading, subPath, navigate]);

  if (subParts[0] === "auth") return <MobileAuth />;
  if (subParts[0] === "group-invite" && subParts[1]) return <MobileGroupInviteAccept token={subParts[1]} />;
  if (subParts[0] === "dashboard") return <MobileDashboard />;
  if (subParts[0] === "group" && subParts[1] && subParts[2] === "chat") {
    return <MobileGroupChat groupId={subParts[1]} />;
  }
  if (subParts[0] === "group" && subParts[1]) return <MobileGroupRoom groupId={subParts[1]} />;
  // Dashboard "write by yourself" — private-only standalone (no group).
  if (subParts[0] === "show-room" && subParts[1] === "private" && subParts[2]) {
    return <MobileShowRoom privateShowId={subParts[2]} />;
  }
  if (subParts[0] === "show-room" && subParts[1]) return <MobileShowRoom roomId={subParts[1]} />;
  // Read-only view of a person's watch pool (byline taps in show rooms).
  if (subParts[0] === "pool" && subParts[1]) return <MobilePool username={decodeURIComponent(subParts[1])} />;
  return <MobileNarrative />;
}
