import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import MobileNarrative from "./MobileNarrative";
import MobileAuth from "./MobileAuth";
import MobileDashboard from "./MobileDashboard";
import MobileGroupRoom from "./MobileGroupRoom";
import MobileGroupChat from "./MobileGroupChat";
import MobileShowRoom from "./MobileShowRoom";

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

// Mobile-scoped placeholder color. Class-scoped (.m-input) so it doesn't
// bleed into desktop's input styling. Injected once into document.head
// the first time MobileApp mounts; idempotent via the element id check.
function injectMobileStyles() {
  if (typeof document === "undefined") return;
  const id = "mobile-input-placeholder";
  if (document.getElementById(id)) return;
  const styleEl = document.createElement("style");
  styleEl.id = id;
  styleEl.textContent = `.m-input::placeholder { color: rgba(253,248,236,0.55); }`;
  document.head.appendChild(styleEl);
}

export default function MobileApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => { injectMobileStyles(); }, []);

  const subPath = location.pathname.replace(/^\/m/, "") || "/";
  const subParts = subPath.split("/").filter(Boolean);

  useEffect(() => {
    if (authLoading) return;
    if (user && subPath === "/") navigate("/m/dashboard", { replace: true });
  }, [user, authLoading, subPath, navigate]);

  if (subParts[0] === "auth") return <MobileAuth />;
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
  return <MobileNarrative />;
}
