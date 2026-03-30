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

export const canView = (t: { season: number; episode: number }, p?: { s: number; e: number }) =>
  !!p && (t.season < p.s || (t.season === p.s && t.episode <= p.e));

export const visibleRepliesCount = (
  threadId: string,
  repliesByThread: { [threadId: string]: Reply[] },
  prog?: { s: number; e: number }
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
