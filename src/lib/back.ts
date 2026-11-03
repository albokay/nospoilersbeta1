/**
 * back — the folded corner goes where you came from (his note, 11-03: from
 * a show room or a group room it kept landing on the dashboard).
 *
 * The previous in-app page wins when there is one: React Router keeps the
 * entry's index in `history.state.idx`, and 0 means this tab opened right
 * here (a daily-email link, a pasted address), so there is nothing to go
 * back to. Then the page the opener named in `state.back`, then the
 * fallback (a room's group room, a group room's dashboard).
 *
 * Every "back" corner uses this, the chat page's too, so no page pushes a
 * fresh entry to "return" and the corner never loops between two pages.
 */
import type { Location, NavigateFunction } from "react-router-dom";

export function goBack(navigate: NavigateFunction, location: Location, fallback: string) {
  const idx = typeof window !== "undefined" ? ((window.history.state as { idx?: number } | null)?.idx ?? 0) : 0;
  if (idx > 0) { navigate(-1); return; }
  const back = (location.state as { back?: string } | null)?.back;
  navigate(back ?? fallback);
}
