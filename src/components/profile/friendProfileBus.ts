// Tiny pub-sub so any desktop surface (feed bylines, nudge pop-ups, the
// group heading's "with…" names) can open the friend-profile drawer without
// prop drilling. The drawer (FriendProfileDrawer) subscribes; it's mounted
// by the pages that host name clicks (dashboard + show room), so at most
// one listener is live at a time.
type Listener = (username: string) => void;
const listeners = new Set<Listener>();

export function openFriendProfile(username: string): void {
  listeners.forEach((l) => l(username));
}

export function onOpenFriendProfile(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
