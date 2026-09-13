// Live room dots (room-signals CP3, 2026-09-13): one realtime channel with
// two bindings per room — a friend's new entry or response re-runs the
// exact-dot fetch (debounced) so the dashboard clusters and group shelves
// light up without a reload. Your own replies don't ding (the fetch would
// come back unchanged). Mirrors the chat listeners' auth handling:
// member-gated rows need the user token on the socket or events silently
// never arrive.
import { supabase } from "./supabaseClient";
import { fetchRoomActivityVisibility, type RoomVisibility } from "./db";

export function subscribeRoomDots(
  userId: string,
  roomIds: string[],
  onUpdate: (rv: RoomVisibility[]) => void,
): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let cancelled = false;
  let debounce: number | null = null;
  const ding = () => {
    if (cancelled) return;
    if (debounce) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      if (cancelled) return;
      fetchRoomActivityVisibility(userId, true)
        .then((rv) => { if (!cancelled) onUpdate(rv); })
        .catch(() => { /* tolerate — the next event retries */ });
    }, 1500);
  };
  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    } catch { /* tolerate */ }
    if (cancelled || !roomIds.length) return;
    let ch = supabase.channel(`room-dots-${userId.slice(0, 8)}`);
    for (const rid of roomIds) {
      ch = ch
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "replies", filter: `group_id=eq.${rid}` },
          (payload) => {
            if ((payload.new as { author_id?: string } | null)?.author_id === userId) return;
            ding();
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "group_threads", filter: `group_id=eq.${rid}` },
          ding,
        );
    }
    channel = ch.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("[room-dots] realtime status:", status);
      }
    });
  })();
  return () => {
    cancelled = true;
    if (debounce) window.clearTimeout(debounce);
    if (channel) supabase.removeChannel(channel);
  };
}
