// GuideNote — the dashboard's note for a friend's guide letter (open letters
// in the show guide, 2026-11-01, CP4 of 5; his canvas Xr3VouchYG1suwyrNDzca1,
// boards OL-PhoneDash / OL-DesktopDash / the modal boards).
//
// The signal comes from the database (get_guide_letter_signals): every
// episode where a friend wrote, and where the viewer stands. One note per
// show, the newest show first, in three phrasings:
//   no position → "Have you watched it?"  — tapping opens the look-up card's
//                 ask (poster left): I've seen it → the picker → the guide;
//                 I want to watch it; Not for me (per show)
//   past        → "Read it →"            — tapping opens the guide with the
//                 letters open on that episode
//   behind      → "It'll open when you get there." — tapping opens the guide,
//                 which ends with the room's sealed-letter row
// A tap holds the show (seen_at); a letter newer than the hold raises the
// note again. "Not for me" holds it for good. A 'past' note also goes on
// its own once the letters were opened in the guide (the seen stamp).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchGuideLetterSignals, fetchProfileNames, holdGuideLetters, type GuideLetterSignal } from "../../lib/db";
import { joinNames } from "../../lib/groupNames";

export type GuideNote = {
  showId: string; showName: string; season: number; episode: number;
  relation: GuideLetterSignal["relation"];
  writers: string; text: string; byline: string; at: number;
};
export type GuideAsk = { showId: string; showName: string; writers: string };
export type GuideAskOutcome = "seen" | "want" | "notForMe" | "close";

export function guideLetterNote(signals: GuideLetterSignal[], nameOf: (id: string) => string): GuideNote | null {
  const byShow = new Map<string, GuideLetterSignal>();
  for (const s of signals) {
    if (s.notForMe) continue;
    if (s.holdSeenAt && Date.parse(s.holdSeenAt) >= Date.parse(s.latestAt)) continue;
    if (s.relation === "past" && s.seenAt && Date.parse(s.seenAt) >= Date.parse(s.latestAt)) continue;
    const cur = byShow.get(s.showId);
    if (!cur || Date.parse(s.latestAt) > Date.parse(cur.latestAt)) byShow.set(s.showId, s);
  }
  let best: GuideLetterSignal | null = null;
  for (const s of byShow.values()) if (!best || Date.parse(s.latestAt) > Date.parse(best.latestAt)) best = s;
  if (!best) return null;
  const writers = joinNames(best.writerIds.map(nameOf));
  const text = best.relation === "past"
    ? "Wrote about it in the show guide. Read it →"
    : best.relation === "behind"
      ? "Wrote about it in the show guide. It’ll open when you get there."
      : "Wrote about it in the show guide. Have you watched it?";
  return { showId: best.showId, showName: best.showName, season: best.season, episode: best.episode, relation: best.relation, writers, text, byline: `${writers} · ${best.showName}`, at: Date.parse(best.latestAt) };
}

export function useGuideLetterNote({ userId, contactNames, mobile }: { userId: string | null | undefined; contactNames: Record<string, string>; mobile: boolean }) {
  const navigate = useNavigate();
  const [signals, setSignals] = useState<GuideLetterSignal[]>([]);
  const [names, setNames] = useState<Record<string, { username: string; displayName: string | null }>>({});
  const [ask, setAsk] = useState<GuideAsk | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) { setSignals([]); return; }
    try {
      const rows = await fetchGuideLetterSignals(null);
      setSignals(rows);
      const ids = Array.from(new Set(rows.flatMap((r) => r.writerIds)));
      if (ids.length) setNames(await fetchProfileNames(ids));
    } catch { setSignals([]); }
  }, [userId]);
  useEffect(() => { refresh(); }, [refresh]);

  const nameOf = useCallback((id: string) => contactNames[id] ?? names[id]?.displayName ?? names[id]?.username ?? "A friend", [contactNames, names]);
  const note = useMemo(() => guideLetterNote(signals, nameOf), [signals, nameOf]);

  const holdSeen = useCallback((showId: string, notForMe = false) => {
    if (!userId) return;
    holdGuideLetters(userId, showId, notForMe ? { seen: true, notForMe: true } : { seen: true }).catch(() => {});
    const now = new Date().toISOString();
    setSignals((prev) => prev.map((s) => (s.showId === showId ? { ...s, holdSeenAt: now, notForMe: s.notForMe || notForMe } : s)));
  }, [userId]);

  /** Tapping the note. */
  const open = useCallback(() => {
    if (!note || !userId) return;
    if (note.relation === "none") { setAsk({ showId: note.showId, showName: note.showName, writers: note.writers }); return; }
    holdSeen(note.showId);
    const prefix = mobile ? "/m/show-room/private" : "/show-room/private";
    // Past: the guide opens the letters; behind: it scrolls to the sealed row.
    navigate(`${prefix}/${note.showId}`, { state: { openReference: true, guideLetterAt: { s: note.season, e: note.episode } } });
  }, [note, userId, mobile, navigate, holdSeen]);

  /** The ask's end: I've seen it (then the picker) / I want to watch it /
   *  Not for me hold the show; the × leaves the note standing. */
  const settleAsk = useCallback((outcome: GuideAskOutcome) => {
    const cur = ask;
    setAsk(null);
    if (!cur || outcome === "close") return;
    holdSeen(cur.showId, outcome === "notForMe");
  }, [ask, holdSeen]);

  return { note, open, ask, settleAsk, refresh };
}
