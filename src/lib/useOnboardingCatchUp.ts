/**
 * useOnboardingCatchUp — keeps a LEFT-BEHIND onboarding tab honest
 * (Alborz 2026-09-16).
 *
 * One sign-in is shared by every Sidebar tab in a browser. When the email
 * link confirms a new account in a fresh tab, the original tab (still on
 * "Check your email") is signed in too — and immediately starts its OWN
 * onboarding, which then sits on the welcome wave while the person finishes
 * setup in the other tab. Coming back to it replayed everything.
 *
 * On return to the tab, while this tab is still pre-group (nothing durable
 * created HERE yet — the caller's `isActive`):
 *  • the account has a group → setup got done elsewhere → `onCaughtUp`
 *    closes this tab's onboarding (the same outcome a reload gives);
 *  • otherwise → `onRefresh` lets the question wave drop cards that were
 *    already answered in the other tab.
 * Once this tab starts its own group it's the active tab, `isActive` goes
 * false, and the hook stays out of the way.
 */
import { useEffect, useRef } from "react";
import { fetchPeopleGroupsForUser } from "./db";

const MIN_GAP_MS = 1500; // visibilitychange + focus both fire on a tab switch

export default function useOnboardingCatchUp(opts: {
  userId: string | undefined;
  /** Read at check time — true only while this tab hasn't created a group. */
  isActive: () => boolean;
  onCaughtUp: () => void;
  onRefresh: () => void;
}) {
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!opts.userId) return;
    let checking = false;
    let lastAt = 0;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const { userId, isActive } = latest.current;
      if (!userId || !isActive() || checking) return;
      if (Date.now() - lastAt < MIN_GAP_MS) return;
      checking = true;
      lastAt = Date.now();
      try {
        const groups = await fetchPeopleGroupsForUser(userId).catch(() => null);
        // The person may have moved on (or this tab started a group) while
        // the read was in flight.
        if (!latest.current.isActive()) return;
        if (groups && groups.length > 0) latest.current.onCaughtUp();
        else latest.current.onRefresh();
      } finally {
        checking = false;
      }
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [opts.userId]);
}
