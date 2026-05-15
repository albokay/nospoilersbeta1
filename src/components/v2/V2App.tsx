import React from "react";
import { useLocation, Navigate } from "react-router-dom";
import V2JournalPage from "./V2JournalPage";
import V2ProfileSelfPage from "./V2ProfileSelfPage";
import V2ProfileVisitorPage from "./V2ProfileVisitorPage";
import V2UserAggregatePage from "./V2UserAggregatePage";
import V2ComposePage from "./V2ComposePage";
import V2FriendRoomPage from "./V2FriendRoomPage";

// Top-level v2 router. Mounted from <App /> as a special-route early-return
// so v2 stays fully isolated from <AppShell />'s data graph during the
// parallel build. See HANDOFF.md "Implementation strategy: parallel build".
export default function V2App() {
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);
  // parts[0] === "v2" by virtue of how V2App is mounted.

  if (parts.length === 1) return <Navigate to="/v2/journal" replace />;

  const seg = parts[1];

  if (seg === "journal") {
    return <V2JournalPage />;
  }

  if (seg === "profile") {
    return <V2ProfileSelfPage />;
  }

  if (seg === "compose") {
    const showId = parts[2];
    return <V2ComposePage showId={showId} />;
  }

  if (seg === "room" && parts[2]) {
    return <V2FriendRoomPage groupId={parts[2]} />;
  }

  if (seg === "u" && parts[2]) {
    const username = parts[2];
    if (parts[3] === "show" && parts[4] && parts[5] === "posts") {
      return <V2UserAggregatePage username={username} showId={parts[4]} />;
    }
    return <V2ProfileVisitorPage username={username} />;
  }

  return <Navigate to="/v2/journal" replace />;
}
