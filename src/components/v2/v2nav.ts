import type { NavigateFunction } from "react-router-dom";

// Navigation into the live ShowSection from v2.
//
// ShowSection inits its `activeGroupId` from a sessionStorage key
// (`ns_active_group_<showId>`) that's written every time the user enters a
// friend-room view on that show (ShowSection.tsx:330). On a subsequent
// nav to /show/<id> WITHOUT `location.state.activeGroupId`, ShowSection
// auto-reopens the last visited room — which means a v2 nav targeting
// the public conversation lands inside the friend room instead.
//
// This helper is the v2-side fix: targeting a specific room writes the
// state hint; targeting public-or-no-room clears the sessionStorage
// so ShowSection inits in public mode. Optional `threadId` lands the
// user directly on an open thread (URL `/show/<id>/thread/<tid>`).

export type ShowNavOpts = {
  threadId?: string;
  activeGroupId?: string;
};

export function navigateToShow(
  navigate: NavigateFunction,
  showId: string,
  opts: ShowNavOpts = {}
): void {
  const { threadId, activeGroupId } = opts;
  if (!activeGroupId) {
    try {
      sessionStorage.removeItem(`ns_active_group_${showId}`);
      sessionStorage.removeItem(`ns_came_from_group_${showId}`);
    } catch {
      // sessionStorage can throw in some embedded contexts; safe to ignore.
    }
  }
  const path = threadId ? `/show/${showId}/thread/${threadId}` : `/show/${showId}`;
  navigate(path, activeGroupId ? { state: { activeGroupId } } : undefined);
}
