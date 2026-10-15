/**
 * The progress picker's first-contact note (Alborz, 10-14; a friend read the
 * numbers row as pagination): a paper note from Sidebar — "Mark the last
 * episode you watched." — on the show room's band while the viewer's
 * progress in that room is 0/0. Gone for good once they pick in a room band
 * on either platform (the flag below) or dismiss the note (its own
 * `ns_dash_note_<uid>:picker` slot, PaperNote's per-account dismissal).
 */
export const PICKER_HINT_TEXT = "Mark the last episode you watched.";

const key = (uid: string) => `ns_picker_hint_${uid}`;

export function pickerHintDone(uid: string | null | undefined): boolean {
  if (!uid) return true;
  try { return window.localStorage.getItem(key(uid)) === "1"; } catch { return true; }
}

export function markPickerHintDone(uid: string | null | undefined): void {
  if (!uid) return;
  try { window.localStorage.setItem(key(uid), "1"); } catch { /* storage off: the note stays until a reload finds progress */ }
}
