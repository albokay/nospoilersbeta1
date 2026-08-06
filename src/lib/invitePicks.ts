/**
 * invitePicks — the invitee's "suggest shows too" picks (Alborz, 2026-08-01).
 *
 * The invite arrival wall now lets the LOGGED-OUT invitee pick shows they'd
 * like to suggest, right where they see the inviter's. They can't write
 * anything yet (no account, and adding a show to the catalog needs auth), so
 * picks park in localStorage — the deckPending pattern — and are CLAIMED
 * right after the invite is accepted: each pick becomes a normal proposal in
 * the group (create the show from TVMaze if it's new, then the same
 * vote-yes + progress-row pair the group room's propose path writes).
 *
 * Keys are token-scoped so an abandoned invite's picks can never leak into a
 * different invite accepted later on the same browser.
 */
import { createShow, ensureProgressRow, setShowVote } from "./db";
import { tvmazeEpisodes, slugify } from "./tvmaze";

export type InviteShowPick =
  | { kind: "catalog"; id: string; name: string }
  | { kind: "tv"; tvmazeId: number; name: string; status?: string };

const key = (token: string) => `ns_invite_show_picks_${token}`;

export function readInvitePicks(token: string): InviteShowPick[] {
  try {
    const raw = localStorage.getItem(key(token));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/** Parked on EVERY change — the join button leaves this page (auth modal on
 *  desktop survives, but signup-with-email-confirm returns via a fresh
 *  load, and mobile navigates to /m/auth outright). */
export function parkInvitePicks(token: string, picks: InviteShowPick[]): void {
  try {
    if (picks.length === 0) localStorage.removeItem(key(token));
    else localStorage.setItem(key(token), JSON.stringify(picks));
  } catch { /* tolerate — suggesting just won't survive the auth hop */ }
}

/**
 * Post-accept: turn the parked picks into proposals in the joined group.
 * Fire-and-forget from the accept pages (it runs while wave 1 plays, so the
 * proposals exist by the time the group room loads). Per-pick tolerant — one
 * failed show doesn't sink the rest; failures just don't propose.
 */
export async function claimInvitePicks(userId: string, groupId: string, token: string): Promise<void> {
  const picks = readInvitePicks(token);
  if (!picks.length) return;
  for (const p of picks) {
    try {
      let showId: string;
      if (p.kind === "catalog") {
        showId = p.id;
      } else {
        const seasons = await tvmazeEpisodes(p.tvmazeId);
        const created = await createShow({ id: slugify(p.name), name: p.name, seasons, tvmazeId: String(p.tvmazeId), status: p.status });
        showId = created.id;
      }
      // The group room's propose pair (CP1): the yes-vote + the S0E0
      // progress row. If the show is already in the group this is simply
      // the invitee's own yes-vote — semantically right for "I suggest it".
      await setShowVote(groupId, showId, true);
      await ensureProgressRow(userId, showId);
    } catch (e) {
      console.warn("[invite-picks] claim failed for", p.name, e);
    }
  }
  parkInvitePicks(token, []);
}
