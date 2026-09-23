/**
 * dashboardSignposts — the arrows at the dashboard's green/yellow border
 * ("Your friend groups" above it, "Your space to collect and log…" below)
 * are orientation for a new user. They show for the first few visits and
 * then retire (Alborz 2026-09-23).
 *
 * A "visit" = one dashboard mount per browser session, counted per user in
 * localStorage (so the phone and the laptop each get their own handful).
 * Storage failures (private mode, blocked) fall back to showing them.
 */
const VISIT_LIMIT = 5;

export function dashboardSignpostsVisible(userId: string): boolean {
  try {
    const key = `ns_dash_visits_${userId}`;
    const sessionKey = `ns_dash_visit_counted_${userId}`;
    let n = parseInt(localStorage.getItem(key) || "0", 10) || 0;
    if (!sessionStorage.getItem(sessionKey)) {
      n += 1;
      localStorage.setItem(key, String(n));
      sessionStorage.setItem(sessionKey, "1");
    }
    return n <= VISIT_LIMIT;
  } catch {
    return true;
  }
}
