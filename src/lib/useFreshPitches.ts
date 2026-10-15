import { useEffect, useState } from "react";
import { fetchGroupShowVotes, fetchGroupShowPasses, fetchGroupPitchActivity, markGroupPitchesSeen } from "./db";

/** The pitches in a group room the viewer hasn't seen (Alborz's notes, round
 *  3): a show's EARLIEST vote is its pitch; it's fresh when someone else made
 *  it after the viewer's pitches_last_seen_at stamp (or the viewer has no
 *  stamp yet). Returns showId → the pitcher's user id, and stamps the room
 *  seen once the marks are drawn — so the dashboard's signal clears for next
 *  time while this visit keeps its marks. Empty when the migration is
 *  missing, when `groupId` is null (the classic skin) or on any failure. */
export type FreshPitches = {
  /** showId → the pitcher, for the pitches the viewer hasn't seen. */
  fresh: Map<string, string>;
  /** showId → the pitcher (the earliest vote), for every pitched show. */
  pitcherOf: Map<string, string>;
  /** The viewer's OWN pitches that a friend answered (in, sitting this out,
   *  seen it) after the same stamp (Alborz, 10-14): the row takes the
   *  identity dot until the viewer opens it, and the stamp clears it for
   *  the next visit like a fresh pitch. */
  freshAnswers: Set<string>;
};
const EMPTY: FreshPitches = { fresh: new Map(), pitcherOf: new Map(), freshAnswers: new Set() };

export default function useFreshPitches(groupId: string | null | undefined, userId: string | null | undefined): FreshPitches {
  const [fresh, setFresh] = useState<FreshPitches>(EMPTY);
  useEffect(() => {
    if (!groupId || !userId) { setFresh(EMPTY); return; }
    let cancelled = false;
    (async () => {
      try {
        const [votes, activity, passes] = await Promise.all([fetchGroupShowVotes(groupId), fetchGroupPitchActivity(userId), fetchGroupShowPasses(groupId)]);
        if (cancelled) return;
        const seen = activity.find((a) => a.groupId === groupId)?.pitchesLastSeenAt ?? null;
        const earliest = new Map<string, { userId: string; at: number }>();
        for (const v of votes) {
          const cur = earliest.get(v.showId);
          if (!cur || v.createdAt < cur.at) earliest.set(v.showId, { userId: v.userId, at: v.createdAt });
        }
        const next = new Map<string, string>();
        const pitcherOf = new Map<string, string>();
        for (const [showId, e] of earliest) {
          pitcherOf.set(showId, e.userId);
          if (e.userId !== userId && (seen == null || e.at > seen)) next.set(showId, e.userId);
        }
        const freshAnswers = new Set<string>();
        for (const v of votes) {
          if (pitcherOf.get(v.showId) === userId && v.userId !== userId && (seen == null || v.createdAt > seen)) freshAnswers.add(v.showId);
        }
        for (const p of passes) {
          if (pitcherOf.get(p.showId) === userId && p.userId !== userId && p.createdAt != null && (seen == null || p.createdAt > seen)) freshAnswers.add(p.showId);
        }
        setFresh({ fresh: next, pitcherOf, freshAnswers });
        markGroupPitchesSeen(groupId).catch(() => { /* the stamp waits for the migration */ });
      } catch {
        if (!cancelled) setFresh(EMPTY);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, userId]);
  return fresh;
}
