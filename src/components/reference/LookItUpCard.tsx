/**
 * LookItUpCard — THE show card (editorial; his call, 2026-11-04): the one
 * card for tapping any show — the look-up band's browse rows and search, and
 * now every poster on a friend's profile (the canon rows and the three
 * shelves alike; the profile's hover note with its group acts is retired).
 *
 * The show in Lora 34 under its poster, then: on a friend's profile one line
 * of what the profile knows and browse doesn't ("You're 2 episodes ahead of
 * Adam."); "How far in are you?", the numbers picker; a position picked →
 * "Open show guide" (the block) + "Just log my progress" (the frame); none →
 * "Want to watch" (or "On your want-to-watch list · Remove show") + "Just
 * log my progress"; the trailer under. The dialog on desktop, the sheet on
 * the phone. Writes the viewer's OWN progress only — never a proposal.
 * Refreshes a stale catalog row on open (the Survivor catch, 11-02), so the
 * picker shows every aired episode.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { refreshShowIfStale, upsertRewatchStatus, type Show } from "../../lib/db";
import type { ProgressEntry } from "../../types";
import { stampReferenceLookup, markWantToWatch, clearWantToWatch } from "../../lib/reference";
import TrailerCard from "../TrailerCard";
import LoadingDots from "../LoadingDots";
import { E } from "../../styles/editorial";
import { UnderlineWord } from "../editorial/Chrome";
import { EditorialDialog, EditorialSheet, NumbersPicker } from "../editorial/GroupRoom";
import { Block, Frame } from "../editorial/Onboarding";

/** The editorial card's shell: the phone's sheet, the desktop's dialog. */
export function EdShell({ mobile, children, onClose, label }: { mobile: boolean; children: React.ReactNode; onClose: () => void; label: string }) {
  return mobile
    ? <EditorialSheet onClose={onClose}>{children}</EditorialSheet>
    : <EditorialDialog onClose={onClose} width={480} label={label} align="left">{children}</EditorialDialog>;
}

/** The viewer's new progress row for a pick: the reading ceiling never
 *  lowers for a show that already has a row. */
export function loggedEntry(existing: ProgressEntry | undefined, picked: { s: number; e: number }): ProgressEntry {
  const exHS = existing?.highestS ?? 0;
  const exHE = existing?.highestE ?? 0;
  const keepCeiling = exHS > picked.s || (exHS === picked.s && exHE >= picked.e);
  return { s: picked.s, e: picked.e, highestS: keepCeiling ? exHS : picked.s, highestE: keepCeiling ? exHE : picked.e };
}

export default function LookItUpCard({ show, mobile, poster, existing, gapLine, onClose, onLogged, onWanted, onUnwanted }: {
  show: Show;
  mobile: boolean;
  /** The poster when the host knows it (TVMaze medium). */
  poster?: string | null;
  /** The viewer's own row for the show, if any — seeds the picker and says whether it's on the want list. */
  existing?: ProgressEntry;
  /** A friend's profile: the gap to them, under the title. */
  gapLine?: string | null;
  onClose: () => void;
  /** After a log (either act): the viewer's merged row, for the host's own state. */
  onLogged?: (showId: string, entry: ProgressEntry) => void;
  onWanted?: (showId: string) => void;
  onUnwanted?: (showId: string) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  // The catalog row may be weeks old when nobody has the show in a pool: the
  // card refreshes it on open (the 12-hour cadence; a no-op when fresh) and
  // swaps the new counts in while it's up. A host that refreshes too simply
  // passes the newer row down.
  const [fresh, setFresh] = useState<Show>(show);
  useEffect(() => { setFresh(show); }, [show]);
  useEffect(() => {
    let cancelled = false;
    refreshShowIfStale(show).then((u) => { if (u && !cancelled) setFresh(u); }).catch(() => { /* the stored counts, then */ });
    return () => { cancelled = true; };
  }, [show.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<{ s: number; e: number }>(existing ? { s: existing.s, e: existing.e } : { s: 0, e: 0 });
  const pickedReady = picked.s >= 1 && picked.e >= 1;
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [logBusy, setLogBusy] = useState(false);
  const [wantBusy, setWantBusy] = useState(false);
  const busy = confirmBusy || logBusy || wantBusy;

  // "Just log my progress": the same write as the guide, but the card just
  // closes. Zero logs as S0 E0 like any position (Alborz 2026-09-29).
  async function justLogIt() {
    if (!user || busy) return;
    setLogBusy(true);
    try {
      const entry = loggedEntry(existing, picked);
      await upsertRewatchStatus(user.id, fresh.id, entry);
      stampReferenceLookup(user.id, fresh.id); // freshness + un-hide, fire-and-forget
      onLogged?.(fresh.id, { ...(existing ?? {}), ...entry, lastLookedUpAt: Date.now(), shelfHiddenAt: undefined });
      onClose();
    } catch (e) { console.error("[show-card] just-log failed", e); }
    finally { setLogBusy(false); }
  }
  // "Open show guide": progress only, then the show's own page at the guide.
  async function lookItUp() {
    if (!user || !pickedReady || busy) return;
    setConfirmBusy(true);
    try {
      const entry = loggedEntry(existing, picked);
      await upsertRewatchStatus(user.id, fresh.id, entry);
      stampReferenceLookup(user.id, fresh.id);
      onLogged?.(fresh.id, { ...(existing ?? {}), ...entry, lastLookedUpAt: Date.now(), shelfHiddenAt: undefined });
      navigate(`${mobile ? "/m/show-room/private" : "/show-room/private"}/${fresh.id}`, { state: { openReference: true } });
    } catch (e) {
      console.error("[show-card] look-it-up failed", e);
      setConfirmBusy(false);
    }
  }
  async function wantIt() {
    if (!user || busy) return;
    setWantBusy(true);
    try {
      await markWantToWatch(user.id, fresh.id);
      onWanted?.(fresh.id);
      onClose();
    } catch (e) { console.error("[show-card] want-to-watch failed", e); }
    finally { setWantBusy(false); }
  }
  function unwant() {
    if (user) clearWantToWatch(user.id, fresh.id); // fire-and-forget
    onUnwanted?.(fresh.id);
  }

  return (
    <EdShell mobile={mobile} onClose={() => { if (!confirmBusy) onClose(); }} label={fresh.name}>
      <div style={{ textAlign: "center" }}>
        {/* The poster over the title (Alborz's notes, round 5), when the host knows it. */}
        {poster && <img src={poster} alt="" draggable={false} style={{ width: 72, height: 104, objectFit: "cover", display: "block", margin: `${mobile ? 22 : 4}px auto 0` }} />}
        <div style={{ ...E.type.question30, fontSize: 34, lineHeight: 1.05, letterSpacing: "-0.01em", marginTop: poster ? 16 : (mobile ? 26 : 6), padding: "0 20px" }}>{fresh.name}</div>
        {gapLine && <div style={{ ...E.type.note13, color: E.color.inkSub, marginTop: 10 }}>{gapLine}</div>}
        <div style={{ ...E.type.label11, marginTop: 22 }}>How far in are you?</div>
        <div style={{ ...E.type.note13, color: E.color.inkSub, marginTop: 6 }}>Set your episode. Nothing you see will ever go past it.</div>
        <NumbersPicker show={fresh} value={picked} onChange={(v) => setPicked(v)} />
        {pickedReady ? (
          <>
            <Block onClick={lookItUp} disabled={busy} style={{ marginTop: 24 }}>{confirmBusy ? <>one moment<LoadingDots /></> : "Open show guide"}</Block>
            <Frame onClick={justLogIt} disabled={busy} style={{ marginTop: 10 }}>{logBusy ? <>one moment<LoadingDots /></> : "Just log my progress"}</Frame>
          </>
        ) : (
          <>
            {existing?.wantedAt ? (
              <div style={{ ...E.type.note13, marginTop: 24, display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
                <span>On your want-to-watch list</span>
                <UnderlineWord onClick={unwant}>Remove show</UnderlineWord>
              </div>
            ) : (
              <Block onClick={wantIt} disabled={busy} style={{ marginTop: 24 }}>{wantBusy ? <>one moment<LoadingDots /></> : "Want to watch"}</Block>
            )}
            <Frame onClick={justLogIt} disabled={busy} style={{ marginTop: 10 }}>{logBusy ? <>one moment<LoadingDots /></> : "Just log my progress"}</Frame>
          </>
        )}
        <div style={{ marginTop: 22, display: "flex", justifyContent: "center" }}><TrailerCard showId={fresh.id} tvmazeId={fresh.tvmazeId ?? null} bleed={mobile ? E.space.gutter : 32} /></div>
      </div>
    </EdShell>
  );
}
