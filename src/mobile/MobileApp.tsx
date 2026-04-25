import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import MobileNarrative from "./MobileNarrative";
import MobileAuth from "./MobileAuth";
import MobileRooms from "./MobileRooms";

// Mobile entry point. Mounts on any path under /m/* via the top-level <App>
// router in src/App.tsx. Bypasses the desktop mobile lockout automatically
// because <App>'s early-return block fires before <AppShell> (where the
// lockout gate lives) is ever reached.
//
// Sub-routes (parsed off the /m prefix):
//   /m              → narrative + sign-in CTA (signed out) | redirect to /m/rooms (signed in)
//   /m/auth         → full-screen sign-in / create-account form
//   /m/rooms        → post-signin landing (room list — Phase 1 placeholder)
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
    if (user && subPath === "/") navigate("/m/rooms", { replace: true });
  }, [user, authLoading, subPath, navigate]);

  if (subParts[0] === "auth") return <MobileAuth />;
  if (subParts[0] === "rooms") return <MobileRooms />;
  return <MobileNarrative />;
}
