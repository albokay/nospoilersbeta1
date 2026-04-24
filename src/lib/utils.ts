import type { Thread, Reply } from '../types';

export const timeAgo = (ms: number) => {
  const diffMs = Date.now() - ms;
  const hours = Math.max(1, Math.floor(diffMs / 3_600_000));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  return hours === 1 ? "<1 hr. ago" : `${hours} hr. ago`;
};

export const buildProgressOptions = (show: { seasons?: number[] }) => {
  const out: { id: string; label: string; s: number; e: number }[] = [];
  const seasons = show?.seasons || [];
  for (let s = 1; s <= seasons.length; s++) {
    const eMax = seasons[s - 1] || 1;
    for (let e = 1; e <= eMax; e++) {
      const id = `${s}-${e}`;
      out.push({ id, label: `you've watched S${String(s).padStart(2, "0")} E${String(e).padStart(2, "0")}`, s, e });
    }
  }
  return out;
};

// A viewer's *effective* watch position for spoiler filtering.
// A rewatcher's real spoiler ceiling is their highest-ever point — their
// rewatch position can be low even though they know everything up through
// highest. Filter calls must go through this so rewatchers see the posts
// they're entitled to (including their own).
export type ViewerProgress = {
  s: number;
  e: number;
  isRewatching?: boolean;
  highestS?: number;
  highestE?: number;
};

export const effectiveProgress = (
  p?: ViewerProgress | null
): { s: number; e: number } | null => {
  if (!p) return null;
  if (p.isRewatching && p.highestS != null && p.highestE != null) {
    return { s: p.highestS, e: p.highestE };
  }
  return { s: p.s, e: p.e };
};

export const canView = (
  t: { season: number; episode: number },
  p?: ViewerProgress | null
) => {
  const eff = effectiveProgress(p);
  return !!eff && (t.season < eff.s || (t.season === eff.s && t.episode <= eff.e));
};

export const isZeroProgress = (p?: { s: number; e: number } | null) =>
  !!p && p.s === 0 && p.e === 0;

// Partial email mask for display surfaces where the address shouldn't be
// flaunted but the owner should still recognize it at a glance. Keeps the
// first character of the local part and the first character of the first
// domain label; hides the remaining characters of each with asterisks,
// one per hidden letter so the length matches the original. Last TLD
// segment is shown in full. "bob@example.com" → "b**@e******.com".
// (The server-side mask in the accept_invitation wrong_recipient response
// uses a fixed three-star shape — different surface, different audience;
// this version is client-side only and safe to make length-accurate
// because the pending-invites list is visible only to the room creator.)
// Returns the raw input for malformed addresses rather than throwing.
export const maskEmail = (email: string): string => {
  if (!email) return email;
  const atIdx = email.indexOf('@');
  if (atIdx < 1) return email;
  const local = email.slice(0, atIdx);
  const parts = email.slice(atIdx + 1).split('.');
  if (parts.length < 2) return email;
  const firstLabel = parts[0];
  const tld = parts[parts.length - 1];
  if (!firstLabel || !tld) return email;
  const maskChunk = (s: string) => s[0] + '*'.repeat(Math.max(0, s.length - 1));
  return `${maskChunk(local)}@${maskChunk(firstLabel)}.${tld}`;
};

export const visibleRepliesCount = (
  threadId: string,
  repliesByThread: { [threadId: string]: Reply[] },
  prog?: ViewerProgress | null
) => {
  if (!prog) return 0;
  const list = repliesByThread[threadId] || [];
  const byId: Record<string, Reply> = {};
  list.forEach(r => (byId[r.id] = r));
  const chainVisible = (r: Reply) => {
    if (!canView({ season: r.season, episode: r.episode }, prog)) return false;
    let cur = r.replyToId ? byId[r.replyToId] : null;
    while (cur) {
      if (!canView({ season: cur.season, episode: cur.episode }, prog)) return false;
      cur = cur.replyToId ? byId[cur.replyToId] : null;
    }
    return true;
  };
  return list.filter(chainVisible).length;
};
