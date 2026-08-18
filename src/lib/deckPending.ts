/**
 * deckPending — pre-account swipe answers (onboarding changeset §5).
 *
 * The invitee answers wave 1 BEFORE the account wall; those swipes park in
 * localStorage and are claimed by whatever account signs in next on this
 * browser (AuthProvider calls claimPendingDeckAnswers on every sign-in).
 *
 * The claim FILLS BLANKS ONLY (Alborz 2026-08-18; was overwrite): a card the
 * account has already answered keeps its real answer. The overwrite rule
 * ("the pre-wall swipe is the freshest opinion") assumed the door is only
 * ever met by strangers — but an EXISTING member invited to a new group
 * would re-answer at the door and silently change their grid. The door is
 * now skipped for known accounts too (the invite lookup's inviteeHasAccount),
 * so this is the backstop for stale door answers left in a browser.
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
    // Fill blanks only: read what the account already has, write the rest.
    const { data: existing, error: readErr } = await supabase
      .from("deck_answers")
      .select("card_id")
      .eq("user_id", userId)
      .in("card_id", entries.map(([card_id]) => card_id));
    if (readErr) {
      console.warn("[deck] pending-answer claim: read failed — will retry next sign-in");
      return;
    }
    const have = new Set((existing ?? []).map((r: any) => r.card_id as string));
    const toWrite = entries.filter(([card_id]) => !have.has(card_id));
    const results = await Promise.all(
      toWrite.map(([card_id, answer]) =>
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
