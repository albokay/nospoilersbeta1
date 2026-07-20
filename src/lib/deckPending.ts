/**
 * deckPending — pre-account swipe answers (onboarding changeset §5).
 *
 * The invitee answers wave 1 BEFORE the account wall; those swipes park in
 * localStorage and are claimed by whatever account signs in next on this
 * browser (AuthProvider calls claimPendingDeckAnswers on every sign-in).
 * The claim OVERWRITES any existing stored answer for the same card — the
 * pre-wall swipe is the person's freshest opinion (Alborz, CP review).
 *
 * Known accepted edge: the answers live in THIS browser. A brand-new
 * invitee who confirms their email on a different device loses the four
 * pre-wall swipes and simply re-answers through the normal waves.
 */
import { supabase } from "./supabaseClient";

const KEY = "ns_deck_pending";

export function readPendingDeckAnswers(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export function addPendingDeckAnswer(cardId: string, answer: boolean): void {
  try {
    const cur = readPendingDeckAnswers();
    cur[cardId] = answer;
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch { /* tolerate — the wave re-serves unanswered cards later */ }
}

/** Flush parked answers into the signed-in account; clears the store only
 *  when every write landed (a partial failure retries on the next sign-in —
 *  re-upserting the successful ones is harmless). Fire-and-forget safe. */
export async function claimPendingDeckAnswers(userId: string): Promise<void> {
  const entries = Object.entries(readPendingDeckAnswers());
  if (!entries.length) return;
  try {
    const results = await Promise.all(
      entries.map(([card_id, answer]) =>
        supabase
          .from("deck_answers")
          .upsert({ user_id: userId, card_id, answer }, { onConflict: "user_id,card_id" }),
      ),
    );
    if (results.some((r) => r.error)) {
      console.warn("[deck] pending-answer claim partially failed — will retry next sign-in");
      return;
    }
    localStorage.removeItem(KEY);
  } catch (e) {
    console.warn("[deck] pending-answer claim failed — will retry next sign-in:", e);
  }
}
