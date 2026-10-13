import { useEffect, useState } from "react";
import { fetchGroupShowVotes, fetchGroupPitchActivity, markGroupPitchesSeen } from "./db";

/** The pitches in a group room the viewer hasn't seen (Alborz's notes, round
 *  3): a show's EARLIEST vote is its pitch; it's fresh when someone else made
 *  it after the viewer's pitches_last_seen_at stamp (or the viewer has no
 *  stamp yet). Returns showId → the pitcher's user id, and stamps the room
 *  seen once the marks are drawn — so the dashboard's signal clears for next
 *  time while this visit keeps its marks. Empty when the migration is
 *  missing, when `groupId` is null (the classic skin) or on any failure. */
export default function useFreshPitches(groupId: string | null | undefined, userId: string | null | undefined): Map<string, string> {
  const [fresh, setFresh] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    if (!groupId || !userId) { setFresh(new Map()); return; }
    let cancelled = false;
    (async () => {
      try {
        const [votes, activity] = await Promise.all([fetchGroupShowVotes(groupId), fetchGroupPitchActivity(userId)]);
        if (cancelled) return;
        const seen = activity.find((a) => a.groupId === groupId)?.pitchesLastSeenAt ?? null;
        const earliest = new Map<string, { userId: string; at: number }>();
        for (const v of votes) {
          const cur = earliest.get(v.showId);
          if (!cur || v.createdAt < cur.at) earliest.set(v.showId, { userId: v.userId, at: v.createdAt });
        }
        const next = new Map<string, string>();
        for (const [showId, e] of earliest) if (e.userId !== userId && (seen == null || e.at > seen)) next.set(showId, e.userId);
        setFresh(next);
        markGroupPitchesSeen(groupId).catch(() => { /* the stamp waits for the migration */ });
      } catch {
        if (!cancelled) setFresh(new Map());
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, userId]);
  return fresh;
}
