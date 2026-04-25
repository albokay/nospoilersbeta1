import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import MobileNarrative from "./MobileNarrative";
import MobileAuth from "./MobileAuth";
import MobileRooms from "./MobileRooms";
import MobileProgressGate from "./MobileProgressGate";
import MobileRoom from "./MobileRoom";
import MobileThread from "./MobileThread";
import MobileCompose from "./MobileCompose";
import MobileRespond from "./MobileRespond";
import MobileInvite from "./MobileInvite";
import MobileInviteAccept from "./MobileInviteAccept";
import MobileRoomMenu from "./MobileRoomMenu";

// Mobile entry point. Mounts on any path under /m/* via the top-level <App>
// router in src/App.tsx. Bypasses the desktop mobile lockout automatically
// because <App>'s early-return block fires before <AppShell> (where the
// lockout gate lives) is ever reached.
//
// Sub-routes (parsed off the /m prefix):
//   /m                              → narrative + sign-in CTA (signed out)
//                                     | redirect to /m/rooms (signed in)
//   /m/auth                         → full-screen sign-in / create-account
//                                     (?returnTo= supported for invite flow)
//   /m/invite/:token                → mobile invite-accept screen
//   /m/rooms                              → room list + show search (S3)
//   /m/rooms/new                          → progress gate, new-room mode (S5)
//   /m/rooms/:groupId/progress                       → progress gate, existing-room (S5)
//   /m/rooms/:groupId/thread/:threadId/respond       → reply composer
//   /m/rooms/:groupId/thread/:threadId               → thread view
//   /m/rooms/:groupId/compose                        → new-entry composer
//   /m/rooms/:groupId/invite                         → invite friend (creator only, server-enforced)
//   /m/rooms/:groupId/menu                           → S7 dropdown (other rooms / search / invite)
//   /m/rooms/:groupId                                → room view (S6)
//
// Auto-redirect rule: signed-in users on bare /m get bounced to /m/rooms so
// they don't have to scroll past the narrative pitch every time. Mirrors the
// desktop redirect rule for signed-in non-admins on / → /profile.
export default function MobileApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const subPath = location.pathname.replace(/^\/m/, "") || "/";
  const subParts = subPath.split("/").filter(Boolean);

  useEffect(() => {
    if (authLoading) return;
    // Bare /m for signed-in users → /m/rooms. Don't bounce away from
    // /m/invite/:token even if signed in — that's the active flow.
    if (user && subPath === "/") navigate("/m/rooms", { replace: true });
  }, [user, authLoading, subPath, navigate]);

  if (subParts[0] === "auth") return <MobileAuth />;
  if (subParts[0] === "invite" && subParts[1]) return <MobileInviteAccept token={subParts[1]} />;
  if (subParts[0] === "rooms" && subParts[1] === "new") return <MobileProgressGate mode="new" />;
  if (subParts[0] === "rooms" && subParts[1] && subParts[2] === "progress") {
    return <MobileProgressGate mode="existing" groupId={subParts[1]} />;
  }
  if (subParts[0] === "rooms" && subParts[1] && subParts[2] === "thread" && subParts[3] && subParts[4] === "respond") {
    return <MobileRespond groupId={subParts[1]} threadId={subParts[3]} />;
  }
  if (subParts[0] === "rooms" && subParts[1] && subParts[2] === "thread" && subParts[3]) {
    return <MobileThread groupId={subParts[1]} threadId={subParts[3]} />;
  }
  if (subParts[0] === "rooms" && subParts[1] && subParts[2] === "compose") {
    return <MobileCompose groupId={subParts[1]} />;
  }
  if (subParts[0] === "rooms" && subParts[1] && subParts[2] === "invite") {
    return <MobileInvite groupId={subParts[1]} />;
  }
  if (subParts[0] === "rooms" && subParts[1] && subParts[2] === "menu") {
    return <MobileRoomMenu groupId={subParts[1]} />;
  }
  if (subParts[0] === "rooms" && subParts[1]) {
    return <MobileRoom groupId={subParts[1]} />;
  }
  if (subParts[0] === "rooms") return <MobileRooms />;
  return <MobileNarrative />;
}

