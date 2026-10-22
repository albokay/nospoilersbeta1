/**
 * NudgeAnswerGate — a nudge opens by itself on the nudged friend's next
 * visit (the friend who pulls ahead, CP2, 2026-10-22; his call: once per
 * batch, anywhere they land). Mounted once under the auth provider, so it
 * covers both platforms: on sign-in (or a fresh load) it reads the
 * viewer's unanswered, unseen nudges and opens the first room's as the
 * answer sheet. Closing without answering marks them seen (the sheet),
 * so they wait as that room's paper note instead; a second room's batch
 * waits for the next visit. Never on a compose page or the invite door,
 * and the show room handles its own (?answer= and the note), so the gate
 * stands down there.
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { fetchPendingNudges, type PendingNudge } from "../lib/db";
import { useEditorial } from "../lib/skin";
import NudgeAnswerSheet from "./NudgeAnswerSheet";

export default function NudgeAnswerGate() {
  const { user, loading } = useAuth();
  const editorial = useEditorial();
  const location = useLocation();
  const navigate = useNavigate();
  const [batch, setBatch] = useState<PendingNudge[] | null>(null);
  const [checkedFor, setCheckedFor] = useState<string | null>(null);

  const path = location.pathname;
  const mobile = /^\/m(\/|$)/.test(path);
  // Pages that keep the gate quiet: a show room (it has its own sheet and
  // note), writing, the invite door, the account pages, the homepage.
  const quiet = /\/show-room\//.test(path) || /\/compose|\/auth|\/group-invite|\/invite|\/confirm|\/reset-password/.test(path) || path === "/" || path === "/m";

  useEffect(() => {
    if (loading || !user || !editorial || quiet || checkedFor === user.id) return;
    let cancelled = false;
    setCheckedFor(user.id);
    fetchPendingNudges(user.id, { unseenOnly: true }).then((all) => {
      if (cancelled || !all.length) return;
      const room = all[0].groupId;
      setBatch(all.filter((n) => n.groupId === room));
    });
    return () => { cancelled = true; };
  }, [loading, user, editorial, quiet, checkedFor]);

  if (!user || !batch?.length) return null;
  return (
    <NudgeAnswerSheet
      nudges={batch}
      userId={user.id}
      mobile={mobile}
      onClose={() => setBatch(null)}
      onLeftRoom={() => {
        // Left from a group room or dashboard: the shelves refresh on their
        // own next load; nudge the current page to reload its data.
        const g = batch[0].parentGroupId;
        navigate(mobile ? (g ? `/m/group/${g}` : "/m/dashboard") : (g ? `/dashboard?g=${g}` : "/dashboard"), { replace: true });
      }}
    />
  );
}
