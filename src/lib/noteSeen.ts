/**
 * Per-ACCOUNT "opened" stamp for highlight notes (Alborz 2026-10-08).
 *
 * A stretch that carries readable notes AND sealed ones used to stay yellow
 * for good, so the sealed note hid behind it. Once its readable notes have
 * been OPENED (the paper on desktop, the sheet on the phone — the same act
 * that clears a letter's blue note signal), the stretch draws in the sealed
 * style from then on, so the sealed note is what you notice next time.
 *
 * The stamp lives on the server (`highlight_seen`, one row per you + note;
 * see supabase/migrations/20261008_highlight_seen.sql) so it follows the
 * account across devices — his call, unlike the per-device stamps the
 * signals use. This module is the in-memory copy: loaded once per user per
 * session (the room pages start it at load; the body falls back to it),
 * read through `useSeenNoteIds`, and written optimistically by
 * `markNoteIdsSeen` with an insert-only upsert behind it. A failed read
 * means "nothing seen" (yellow, as before) — never an error on screen.
 */
import { useSyncExternalStore } from "react";
import { supabase } from "./supabaseClient";

type State = { userId: string | null; ids: Set<string>; loaded: boolean };
let state: State = { userId: null, ids: new Set(), loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function snapshot() { return state; }

/** The ids of the notes this account has opened (a stable Set per change). */
export function useSeenNoteIds(): Set<string> {
  return useSyncExternalStore(subscribe, snapshot, snapshot).ids;
}

/** Load the account's stamps once per session (a new user id reloads).
 *  Marks made before the load lands are kept. */
export function loadSeenNoteIds(userId: string): Promise<void> {
  if (state.userId === userId && (state.loaded || loading)) return loading ?? Promise.resolve();
  state = { userId, ids: new Set(), loaded: false };
  emit();
  loading = (async () => {
    try {
      const { data, error } = await supabase.from("highlight_seen").select("highlight_id").eq("user_id", userId);
      if (error) throw error;
      if (state.userId !== userId) return;
      const ids = new Set(state.ids);
      for (const r of (data ?? []) as { highlight_id: string }[]) ids.add(r.highlight_id);
      state = { userId, ids, loaded: true };
    } catch (e) {
      console.error("[noteSeen] load failed", e);
      if (state.userId === userId) state = { ...state, loaded: true };
    } finally {
      loading = null;
      emit();
    }
  })();
  return loading;
}

/** Stamp these notes as opened: the screen flips at once, the rows follow. */
export function markNoteIdsSeen(userId: string, ids: string[]): void {
  const fresh = ids.filter((id) => !state.ids.has(id));
  if (fresh.length === 0) return;
  const next = new Set(state.ids);
  for (const id of fresh) next.add(id);
  state = { ...state, userId: state.userId ?? userId, ids: next };
  emit();
  supabase
    .from("highlight_seen")
    .upsert(fresh.map((id) => ({ user_id: userId, highlight_id: id })), { onConflict: "user_id,highlight_id", ignoreDuplicates: true })
    .then(({ error }) => { if (error) console.error("[noteSeen] write failed", error); });
}
