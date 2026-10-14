/**
 * Invite.tsx — the invitee's path and the invite flow under the editorial
 * skin (checkpoint 7, part two, 2026-10-12; the E3Inv* / D3Inv* boards and
 * the bible's Steps + Form). The invite wall loads the inviter's pool the
 * way the classic walls do and draws it as "{Name} picked {Show} to watch
 * with you." on an accent band (one show) or as the watch pool's shelves
 * (several); the sent state is the personal band with the friends' Copy
 * link rows; the states card is a page on cream.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { E } from "../../styles/editorial";
import { fetchShows, fetchPublicProfileByUsername, fetchPublicProgressForUser, fetchPublicPool, fetchInvitePool, type PublicPoolShow, type Show, type GroupInviteInfo } from "../../lib/db";
import type { ProgressEntry } from "../../types";
import { getTrailerKeyCached } from "../../lib/trailers";
import { joinNames } from "../../lib/groupNames";
import { RowPoster } from "./GroupRoom";
import { SectionHead } from "./Chrome";
import { Wordmark, Block, Frame, COLUMN, LinkRows } from "./Onboarding";
import InviteShowSuggest from "../InviteShowSuggest";
import InviteShowCard from "../InviteShowCard";
import LoadingDots from "../LoadingDots";

/** The page's frame: the wordmark centred at the top, the content under it. */
export function InvitePage({ desktop = false, children, style }: { desktop?: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ position: "relative", minHeight: desktop ? "100vh" : "100dvh", background: E.color.cream, color: E.color.ink, fontFamily: E.font.interface, boxSizing: "border-box", padding: desktop ? "0 0 80px" : `${E.safe.top} ${E.space.gutter}px calc(env(safe-area-inset-bottom, 0px) + 48px)`, ...style }}>
      <div style={{ position: "absolute", left: "50%", top: desktop ? 36 : E.safe.plus(24), transform: "translateX(-50%)", zIndex: 3 }}><Wordmark height={desktop ? 34 : 26} /></div>
      {children}
    </div>
  );
}

type PoolShow = { show: Show; entry: ProgressEntry };

/** The inviter's pool, loaded like the classic walls (group-scoped when the server knows the invite). */
function useInviterPool(token: string, inviterUsername: string) {
  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [pool, setPool] = useState<{ proposals: PublicPoolShow[]; rooms: PublicPoolShow[] } | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prof = await fetchPublicProfileByUsername(inviterUsername);
        if (!prof || cancelled) return;
        const [allShows, prog, pp] = await Promise.all([
          fetchShows(), fetchPublicProgressForUser(prof.id),
          fetchInvitePool(token).then((p) => p ?? fetchPublicPool(prof.id)),
        ]);
        if (cancelled) return;
        setShows(allShows); setProgress(prog); setPool(pp);
      } catch { /* the wall degrades to the headline + Join */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [token, inviterUsername]);
  const showsById = useMemo(() => { const m: Record<string, Show> = {}; for (const s of shows) m[s.id] = s; return m; }, [shows]);
  const { watching, interested } = useMemo(() => {
    const byName = (a: PoolShow, b: PoolShow) => a.show.name.localeCompare(b.show.name);
    if (pool) {
      const map = (rows: PublicPoolShow[]) => rows
        .map((r) => ({ show: showsById[r.showId], entry: { s: r.s, e: r.e } as ProgressEntry }))
        .filter((x): x is PoolShow => !!x.show && !x.show.isHidden)
        .sort(byName);
      const started = (r: PublicPoolShow) => (r.s ?? 0) > 0 || (r.e ?? 0) > 0;
      return { watching: map(pool.rooms.filter(started)), interested: map([...pool.proposals, ...pool.rooms.filter((r) => !started(r))]) };
    }
    const w: PoolShow[] = []; const n: PoolShow[] = [];
    for (const [showId, entry] of Object.entries(progress)) {
      const show = showsById[showId];
      if (!show || show.isHidden || entry.stoppedWatching) continue;
      ((entry.s ?? 0) > 0 || (entry.e ?? 0) > 0 ? w : n).push({ show, entry });
    }
    return { watching: w.sort(byName), interested: n.sort(byName) };
  }, [pool, progress, showsById]);
  return { watching, interested, loaded };
}

function seasonsLabel(show: Show): string | null {
  const n = show.seasons?.length ?? 0;
  return n ? `${n} season${n === 1 ? "" : "s"}` : null;
}

/** The trailer in the band (his notes, 10-14): a 16:9 facade — the trailer's own
 *  still under the cream play disc — that plays in place on one click. Desktop
 *  seats it beside the poster and the lines (300 wide, so Join keeps its seat);
 *  the phone runs it full width under them. The TMDB line rides under it. */
function InlineTrailer({ ytKey, desktop }: { ytKey: string; desktop: boolean }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div style={desktop ? { width: 300, flexShrink: 0 } : { marginTop: 18, width: "100%" }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: E.color.draft, overflow: "hidden" }}>
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${ytKey}?autoplay=1&rel=0`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title="Trailer"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, display: "block" }}
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} aria-label="Play the trailer" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", padding: 0, border: 0, background: "transparent", cursor: "pointer" }}>
            <img src={`https://i.ytimg.com/vi/${ytKey}/hqdefault.jpg`} alt="" loading="lazy" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <span aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 44, height: 44, borderRadius: "50%", background: E.color.cream, border: `1px solid ${E.color.ink}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ marginLeft: 2 }}><path d="M4 2.5v11l9-5.5z" fill={E.color.ink} /></svg>
            </span>
          </button>
        )}
      </div>
      <div style={{ ...E.type.label9, textTransform: "none", letterSpacing: "0.04em", lineHeight: 1.4, color: "rgba(26,58,74,0.75)", marginTop: 8 }}>
        Trailer data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
      </div>
    </div>
  );
}

/** The invite wall: the inviter's pick(s), Join, and the invitee's own picks. */
export function InviteWall({ token, info, inviterName, desktop = false, onJoin }: { token: string; info: GroupInviteInfo; inviterName: string; desktop?: boolean; onJoin: () => void }) {
  const { watching, interested, loaded } = useInviterPool(token, info.inviterName);
  const all = useMemo(() => [...watching, ...interested], [watching, interested]);
  const [trailerFor, setTrailerFor] = useState<Show | null>(null);
  const [trailerOk, setTrailerOk] = useState<Record<string, boolean>>({});
  // The key itself, for the single pick's in-band player.
  const [trailerKeys, setTrailerKeys] = useState<Record<string, string | null>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    for (const { show } of all) {
      if (asked.current.has(show.id)) continue;
      asked.current.add(show.id);
      getTrailerKeyCached(show.id, show.tvmazeId).then((k) => {
        if (cancelled) return;
        setTrailerOk((p) => ({ ...p, [show.id]: !!k }));
        setTrailerKeys((p) => ({ ...p, [show.id]: k ?? null }));
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [all]);
  const others = info.memberNames.filter((n) => n && n !== info.inviterName).map((n) => `@${n}`);
  const withLine = others.length ? `With ${joinNames([inviterName, ...others])}` : null;
  const exclude = useMemo(() => new Set(all.map(({ show }) => Number(show.tvmazeId)).filter((n) => !!n)), [all]);
  const joinLabel = `Join ${inviterName} →`;
  const col: React.CSSProperties = desktop ? COLUMN : {};

  const single = loaded && all.length === 1 ? all[0] : null;
  const pool = loaded && all.length > 1;

  return (
    <InvitePage desktop={desktop}>
      {!loaded ? (
        <div style={{ ...col, paddingTop: desktop ? 130 : 110, ...E.type.label11, color: E.color.inkMuted }}>loading<LoadingDots /></div>
      ) : single ? (
        <>
          <div style={{ ...col, paddingTop: desktop ? 130 : 110 }}>
            <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: desktop ? 40 : 34, lineHeight: 1.1, letterSpacing: "-0.01em" }}>{inviterName} picked {single.show.name} to watch with you.</div>
          </div>
          <div style={desktop ? { background: E.color.accent, padding: "28px 0", marginTop: 40 } : { margin: `30px -${E.space.gutter}px 0`, padding: `22px ${E.space.gutter}px 26px`, background: E.color.accent }}>
            <div style={col}>
              <div style={{ display: "flex", gap: desktop ? 20 : 16, alignItems: "flex-start" }}>
                <div style={{ boxShadow: E.shadow.sidebarLetter, flexShrink: 0, background: E.color.draft }}><RowPoster tvmazeId={single.show.tvmazeId} w={88} h={126} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: E.font.interface, fontWeight: 600, fontSize: desktop ? 20 : 18, letterSpacing: "-0.01em" }}>{single.show.name}</div>
                  {seasonsLabel(single.show) && <div style={{ ...E.type.label10, letterSpacing: "0.04em", color: E.color.inkMuted, marginTop: 4 }}>{seasonsLabel(single.show)}</div>}
                  <div style={{ fontFamily: E.font.interface, fontSize: desktop ? 15 : 14, lineHeight: 1.5, marginTop: 12, maxWidth: 460 }}>
                    {watching.length
                      ? `${inviterName} is at S${single.entry.s} E${single.entry.e}. ${others.length ? `${joinNames(others)} ${others.length > 1 ? "are" : "is"} in too. ` : ""}The room is open and waiting for you.`
                      : `${inviterName} wants to start it with you.${others.length ? ` ${joinNames(others)} ${others.length > 1 ? "are" : "is"} in too.` : ""}`}
                  </div>
                </div>
                {desktop && trailerKeys[single.show.id] && <InlineTrailer ytKey={trailerKeys[single.show.id] as string} desktop />}
              </div>
              {!desktop && trailerKeys[single.show.id] && <InlineTrailer ytKey={trailerKeys[single.show.id] as string} desktop={false} />}
            </div>
          </div>
          <div style={{ ...col, marginTop: 28 }}>
            <Block onClick={onJoin}>{joinLabel}</Block>
            {withLine && <div style={{ ...E.type.label10, letterSpacing: "0.06em", color: E.color.inkMuted, marginTop: 16, textAlign: "center" }}>{withLine}</div>}
            <InviteShowSuggest token={token} idiom={desktop ? "desktop" : "mobile"} editorial={{ inviterName, desktop }} excludeTvmazeIds={exclude} />
          </div>
        </>
      ) : pool ? (
        <>
          <div style={{ ...col, paddingTop: desktop ? 130 : 96 }}>
            <div style={{ ...(desktop ? E.type.title64 : E.type.title46), fontSize: desktop ? 56 : 40 }}>{inviterName}&rsquo;s<br />watch pool:</div>
            <div style={{ ...E.type.label11, color: E.color.inkSub, marginTop: 12 }}>What {inviterName} is watching and wants to watch</div>
          </div>
          <div style={col}>
            {watching.length > 0 && (
              <>
                <SectionHead style={{ marginTop: 36 }} right={<span style={{ color: E.color.inkMuted }}>{watching.length}</span>}>Watching</SectionHead>
                <Shelf items={watching} desktop={desktop} caption={(e) => `S${e.s} E${e.e}`} trailerOk={trailerOk} onOpen={setTrailerFor} />
              </>
            )}
            {interested.length > 0 && (
              <>
                <SectionHead style={{ marginTop: 34 }} right={<span style={{ color: E.color.inkMuted }}>{interested.length}</span>}>Wants to watch</SectionHead>
                <Shelf items={interested} desktop={desktop} caption={() => "Not started"} trailerOk={trailerOk} onOpen={setTrailerFor} />
              </>
            )}
            <InviteShowSuggest token={token} idiom={desktop ? "desktop" : "mobile"} editorial={{ inviterName, desktop }} excludeTvmazeIds={exclude} />
          </div>
          <div style={desktop ? { background: E.color.accent, padding: "18px 0 28px", marginTop: 48 } : { margin: `48px -${E.space.gutter}px 0`, padding: `18px ${E.space.gutter}px 28px`, background: E.color.accent }}>
            <div style={col}>
              <div style={{ fontFamily: E.font.interface, fontSize: 14, lineHeight: 1.5, marginBottom: 12 }}>Join {inviterName} and your letters wait, sealed, until each of you gets there.</div>
              <Block onClick={onJoin}>{joinLabel}</Block>
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ ...col, paddingTop: desktop ? 130 : 110 }}>
            <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: desktop ? 40 : 34, lineHeight: 1.1, letterSpacing: "-0.01em" }}>{inviterName} wants to watch shows with you.</div>
          </div>
          <div style={{ ...col, marginTop: 28 }}>
            <Block onClick={onJoin}>{joinLabel}</Block>
            {withLine && <div style={{ ...E.type.label10, letterSpacing: "0.06em", color: E.color.inkMuted, marginTop: 16, textAlign: "center" }}>{withLine}</div>}
            <InviteShowSuggest token={token} idiom={desktop ? "desktop" : "mobile"} editorial={{ inviterName, desktop }} excludeTvmazeIds={exclude} />
          </div>
        </>
      )}
      {trailerFor && <InviteShowCard idiom={desktop ? "desktop" : "mobile"} show={trailerFor} onClose={() => setTrailerFor(null)} />}
    </InvitePage>
  );
}

/** A shelf of 104×148 posters with the name and a mono caption. */
function Shelf({ items, desktop, caption, trailerOk, onOpen }: { items: PoolShow[]; desktop: boolean; caption: (e: ProgressEntry) => string; trailerOk: Record<string, boolean>; onOpen: (s: Show) => void }) {
  return (
    <div className="e-strip" style={{ display: "flex", gap: desktop ? 24 : 16, marginTop: 18, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4, ...(desktop ? {} : { marginRight: -E.space.gutter, paddingRight: E.space.gutter }) }}>
      {items.map(({ show, entry }) => {
        const inner = (
          <>
            <span style={{ display: "block", width: 104, height: 148, background: E.color.draft, overflow: "hidden" }}><RowPoster tvmazeId={show.tvmazeId} w={104} h={148} /></span>
            <span style={{ display: "block", fontFamily: E.font.interface, fontWeight: 600, fontSize: 13, marginTop: 10, lineHeight: 1.2 }}>{show.name}</span>
            <span style={{ display: "block", ...E.type.label10, color: E.color.inkMuted, marginTop: 3 }}>{caption(entry)}</span>
          </>
        );
        return trailerOk[show.id]
          ? <button key={show.id} type="button" onClick={() => onOpen(show)} title={`${show.name} — watch the trailer`} style={{ width: 104, flexShrink: 0, background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left", color: E.color.ink }}>{inner}</button>
          : <div key={show.id} style={{ width: 104, flexShrink: 0, color: E.color.ink }}>{inner}</div>;
      })}
    </div>
  );
}

/** The invite's other states: a title, a line, one act. */
export function InviteStatePage({ desktop = false, title, note, action }: { desktop?: boolean; title: React.ReactNode; note?: React.ReactNode; action?: { label: React.ReactNode; onClick: () => void } }) {
  return (
    <InvitePage desktop={desktop}>
      <div style={{ ...(desktop ? COLUMN : {}), paddingTop: desktop ? 150 : 120 }}>
        <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: 28, lineHeight: 1.15, letterSpacing: "-0.01em" }}>{title}</div>
        {note && <div style={{ ...E.type.body15, lineHeight: 1.6, marginTop: 14, color: E.color.inkSub }}>{note}</div>}
        {action && <Frame onClick={action.onClick} style={{ marginTop: 28, width: desktop ? 320 : "100%" }}>{action.label}</Frame>}
      </div>
    </InvitePage>
  );
}

export type SentRow = { email: string; name?: string; link?: string; error?: string; emailFailed?: boolean };

/** "Invites sent!" — the personal band, the sentence, each friend's Copy link row, Done. `inset` = the host's side padding. */
export function InvitesSentBody({ links, onDone, inset }: { links: SentRow[]; onDone: () => void; inset: number }) {
  const sent = links.filter((r) => !r.error && !r.emailFailed && r.link);
  const failed = links.filter((r) => !r.error && r.emailFailed);
  const errors = links.filter((r) => r.error);
  const names = joinNames(sent.map((r) => r.name || r.email));
  return (
    <>
      {errors.length === 0 && failed.length === 0 && (
        <div style={{ padding: `20px ${inset}px 22px`, background: E.color.personal }}>
          <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: 28, lineHeight: 1.1 }}>Invites sent!</div>
          <div style={{ fontFamily: E.font.interface, fontSize: 14, lineHeight: 1.5, marginTop: 8 }}>{names || "Your friends"} will get an email from Sidebar. Until they join, they sit on this group&rsquo;s shelf as outlined circles.</div>
        </div>
      )}
      <div style={{ padding: `20px ${inset}px 0` }}>
        {errors.length > 0 && (
          <div style={{ ...E.type.note13, color: E.color.alert, fontWeight: 600, marginBottom: 14 }}>{errors.map((r, i) => <div key={i}>{r.error}</div>)}</div>
        )}
        {sent.length > 0 && (
          <>
            <div style={{ fontFamily: E.font.interface, fontSize: 14, lineHeight: 1.5, color: E.color.inkSub }}>You can also text them an invite link.</div>
            <LinkRows links={sent.map((r) => ({ name: r.name || r.email, link: r.link as string }))} style={{ marginTop: 12 }} />
          </>
        )}
        {failed.length > 0 && (
          <>
            <div style={{ fontFamily: E.font.interface, fontSize: 14, lineHeight: 1.5, color: E.color.inkSub, marginTop: sent.length ? 20 : 0 }}>
              {failed.length === 1
                ? "Sidebar is having an issue and couldn't email this invite right now. You can copy the link and send it to your friend yourself. It works the same. Or log out, log back in, and try one more time. Sorry for the inconvenience."
                : "Sidebar is having an issue and couldn't email these invites right now. You can copy the links and send them to your friends yourself. They work the same. Or log out, log back in, and try one more time. Sorry for the inconvenience."}
            </div>
            <LinkRows links={failed.filter((r) => r.link).map((r) => ({ name: r.name || r.email, link: r.link as string }))} style={{ marginTop: 12 }} />
          </>
        )}
        <Block onClick={onDone} style={{ marginTop: 28 }}>Done</Block>
      </div>
    </>
  );
}

/** The desktop dialog for the invite form and the sent state: a 480 card with no padding of its own. */
export function InviteDialog({ onClose, label, children }: { onClose: () => void; label: string; children: React.ReactNode }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: E.color.veil, overflowY: "auto", animation: "dDimIn 180ms ease-out" }}>
      <div role="dialog" aria-label={label} style={{ position: "relative", width: 480, maxWidth: "92vw", margin: "120px auto 48px", boxSizing: "border-box", background: E.color.cream, boxShadow: E.shadow.cardStack, color: E.color.ink, overflow: "hidden", padding: "0 0 28px" }}>
        {children}
      </div>
    </div>
  );
}

/** The phone's sent sheet: a veil over the page, the cream sheet rising with the grabber. */
export function SentSheet({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: E.color.veil, animation: "mDimIn 180ms ease-out" }} />
      <div role="dialog" aria-label="Invites sent" style={{ position: "absolute", left: 0, right: 0, top: "min(300px, 36dvh)", bottom: 0, background: E.color.cream, color: E.color.ink, padding: "10px 0 calc(env(safe-area-inset-bottom, 0px) + 24px)", boxSizing: "border-box", overflowY: "auto", animation: "mSheetRise 180ms ease-out" }}>
        <div aria-hidden="true" style={{ width: 36, height: 4, background: E.color.ink, margin: "0 auto 14px" }} />
        {children}
      </div>
    </div>
  );
}
