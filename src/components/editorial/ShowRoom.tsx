/**
 * ShowRoom.tsx — the editorial show room's pieces (checkpoint 4, 2026-10-12;
 * the E3Show* / D3Show* boards and the bible's FolderTabs, Band, PinnedBand,
 * LetterEntry, Stamp, GuideRows). Rendered under the editorial skin only by
 * ShowRoomPage, MobileShowRoom, V2RoomFeed, SidebarLetter and ShowReference;
 * the classic room is untouched.
 *
 *   FolderTabs     filing-folder tabs on the band: hairline tops and sides,
 *                  open bottoms; the selected one taller in its section's
 *                  colour (personal / accent / draft).
 *   RoomBand       the band under the tabs in the tab's colour, carrying
 *                  the progress picker: WATCHED · Season N ▼ · the numbers
 *                  row. A forward pick hands off to the host's rating flow;
 *                  a backward pick asks first (the live warning), then
 *                  commits.
 *   PinnedBand     once the room's head scrolls away: a 48px band in the
 *                  tab's colour with the identity back square, the show ·
 *                  tab · episode in mono, and the map glyph.
 *   EntryShell     a letter in the stream: ink rule above, hairline below,
 *                  the stamp at the right, the head at least 74px tall; a
 *                  closed letter carries a down chevron at its bottom right
 *                  (Alborz 2026-10-13: the expand cue, on every letter).
 *   SealedEntry    FROM · SEALED UNTIL, one dim line, the lock on the stamp.
 *   RoadRule       "You are here · S1 E3" as a mono rule.
 *   SidebarPaper   the letter from Sidebar's paper: hairline frame, the sky
 *                  stack, Sidebar's framed stamp.
 *   WriteBlock / SortWord / MapButton / TourWord   the room's controls.
 *   CastRow / EpisodeRow / DraftRow   the guide's and the drafts' rows.
 */
import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { E } from "../../styles/editorial";
import { NumbersPicker, EditorialDialog } from "./GroupRoom";
import { UnderlineWord } from "./Chrome";

export type RoomTabKey = "friend" | "reference" | "private";
export const TAB_COLOUR: Record<RoomTabKey, string> = { friend: E.color.personal, reference: E.color.accent, private: E.color.draft };
export const TAB_LABEL: Record<RoomTabKey, string> = { friend: "Friend room", reference: "Show guide", private: "Drafts" };

/** The CSS variables the classic room's inner pieces read (the opened
 *  letter, its responses, the edit form), redefined for ink on cream. */
export const FEED_VARS: React.CSSProperties = {
  ["--dos-fg" as any]: E.color.ink, ["--dos-gray" as any]: E.color.inkMuted, ["--dos-light" as any]: E.color.ink,
  ["--dos-cyan" as any]: E.color.ink, ["--dos-accent" as any]: E.color.ink, ["--dos-border" as any]: E.color.draft,
  ["--dos-bg" as any]: E.color.ink, ["--danger" as any]: E.color.alert, ["--icon-color" as any]: E.color.ink,
  color: E.color.ink,
};

export function FolderTabs({ tabs, active, onChange, width, openLeft = false }: { tabs: RoomTabKey[]; active: RoomTabKey; onChange: (t: RoomTabKey) => void; width?: number; /** Desktop (Alborz's notes, round 4): the first tab has no left outline — only its top and right. */ openLeft?: boolean }) {
  return (
    <div role="tablist" aria-label="Room sections" style={{ display: "flex", alignItems: "flex-end", gap: E.space.tabGap, width }}>
      {tabs.map((t, i) => {
        const on = t === active;
        return (
          <button
            key={t} type="button" role="tab" aria-selected={on} onClick={() => onChange(t)}
            style={{
              height: on ? 42 : 36, padding: "0 14px", boxSizing: "border-box", border: `1px solid ${E.color.ink}`, borderBottom: 0, ...(openLeft && i === 0 ? { borderLeft: 0 } : {}),
              background: on ? TAB_COLOUR[t] : E.color.cream, display: "inline-flex", alignItems: "center",
              ...E.type.label11, color: on ? E.color.ink : "rgba(26,58,74,0.7)", cursor: "pointer", WebkitTapHighlightColor: "transparent",
              ...(on ? { marginBottom: -1, position: "relative", zIndex: 2 } : {}),
            }}
          >
            {TAB_LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}

/** The band's picker with the live room's commit rules: a forward pick goes
 *  to `onForwardPick` (the rating flow) when the host has one, else to the
 *  confirm; a backward pick asks the live question first. */
export function RoomPicker({ show, value, onConfirm, onForwardPick, allowZero = true }: {
  show: { seasons?: number[] } | null | undefined;
  value: { s: number; e: number };
  onConfirm: (v: { s: number; e: number }) => void;
  onForwardPick?: (v: { s: number; e: number }) => void;
  allowZero?: boolean;
}) {
  const [pending, setPending] = useState<{ s: number; e: number; backwards: boolean } | null>(null);
  const pick = (v: { s: number; e: number }) => {
    if (v.s === value.s && v.e === value.e) return;
    const backwards = v.s < value.s || (v.s === value.s && v.e < value.e);
    if (!backwards && onForwardPick) { onForwardPick(v); return; }
    setPending({ ...v, backwards });
  };
  return (
    <>
      <NumbersPicker show={show} value={value} onChange={pick} allowZero={allowZero} />
      {pending && (
        <EditorialDialog onClose={() => setPending(null)} width={360} label="Change your progress?" align="left">
          <div style={{ ...E.type.letterTitle22, paddingRight: 28 }}>{pending.backwards ? "Are you sure?" : (pending.s === 0 ? "Haven't started" : `Finished S${pending.s} E${pending.e}`)}</div>
          <div style={{ ...E.type.body15, marginTop: 10 }}>
            {pending.backwards
              ? "Did you mean to turn your progress backwards? If you’ve watched more, you could accidentally spoil things for your friends!"
              : "You’ll only see letters up to your selected episode."}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button type="button" onClick={() => { const v = { s: pending.s, e: pending.e }; setPending(null); onConfirm(v); }} style={{ ...E.type.button16, flex: 1, height: 54, background: pending.backwards ? E.color.alert : E.color.ink, color: E.color.cream, border: 0, cursor: "pointer" }}>{pending.backwards ? "Yes" : "Confirm"}</button>
            <button type="button" onClick={() => setPending(null)} style={{ ...E.type.button16, flex: 1, height: 54, border: `1px solid ${E.color.ink}`, background: "transparent", color: E.color.ink, cursor: "pointer", boxSizing: "border-box" }}>Cancel</button>
          </div>
        </EditorialDialog>
      )}
    </>
  );
}

export function RoomBand({ tab, children, style }: { tab: RoomTabKey; children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ padding: `${E.space.bandPad}px ${E.space.gutter}px 20px`, background: TAB_COLOUR[tab], color: E.color.ink, ...style }}>{children}</div>;
}

const MAP_GLYPH = (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={E.color.ink} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" />
  </svg>
);

/** The phone's pinned band: shown by the host once the head has scrolled away. */
export function PinnedBand({ tab, show, position, onBack, onTop, onMap }: { tab: RoomTabKey; show: string; position: string | null; onBack: () => void; onTop: () => void; onMap?: () => void }) {
  return (
    <div style={{ position: "fixed", left: 0, right: 0, top: 0, height: E.safe.plus(E.space.pinnedBand), background: TAB_COLOUR[tab], display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: E.safe.top, paddingRight: onMap ? 8 : 0, boxSizing: "border-box", zIndex: 30, color: E.color.ink }}>
      <button type="button" aria-label="Back" onClick={onBack} style={{ width: 48, height: 48, display: "inline-flex", alignItems: "center", justifyContent: "center", background: E.color.identity, border: 0, padding: 0, cursor: "pointer", flexShrink: 0 }}>
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={E.color.cream} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
      </button>
      <button type="button" onClick={onTop} title="Back to the top" style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, height: 48, background: "transparent", border: 0, padding: "0 8px", cursor: "pointer", ...E.type.label11, color: E.color.ink, WebkitTapHighlightColor: "transparent" }}>
        <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show}</span>
        <span style={{ opacity: 0.6 }}>·</span>
        <span style={{ whiteSpace: "nowrap" }}>{TAB_LABEL[tab]}</span>
        {position && (<><span style={{ opacity: 0.6 }}>·</span><span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{position}</span></>)}
        <span style={{ fontSize: 9 }}>▼</span>
      </button>
      {onMap && (
        <button type="button" aria-label="Season map" title="Season map" onClick={onMap} style={{ width: 40, height: 48, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: 0, padding: 0, cursor: "pointer", flexShrink: 0 }}>{MAP_GLYPH}</button>
      )}
    </div>
  );
}

/** Watches the page's scroller and says whether `headRef`'s bottom has left the top. */
export function useScrolledPast(scroller: React.RefObject<HTMLElement | null>, headRef: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!enabled) { setPast(false); return; }
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const h = headRef.current;
      if (!h) return;
      setPast(h.getBoundingClientRect().bottom < 0);
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(check); };
    el.addEventListener("scroll", onScroll, { passive: true });
    check();
    return () => { el.removeEventListener("scroll", onScroll); if (raf) window.cancelAnimationFrame(raf); };
  }, [scroller, headRef, enabled]);
  return past;
}

export function MapButton({ onClick, style }: { onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button type="button" onClick={onClick} style={{ width: "100%", height: 44, boxSizing: "border-box", border: `1px solid ${E.color.ink}`, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, ...E.type.label11, color: E.color.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent", ...style }}>
      {MAP_GLYPH}<span>Season map</span>
    </button>
  );
}

export function WriteBlock({ label, onClick, style }: { label: string; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button type="button" onClick={onClick} style={{ ...E.type.button16, height: 56, background: E.color.ink, color: E.color.cream, border: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent", ...style }}>
      {label}
    </button>
  );
}

/** A mono word with a hidden select behind it: the sort / filter, the cast's episode. */
export function SelectWord({ label, value, onChange, children, dim = false, ariaLabel, style }: { label: React.ReactNode; value: string; onChange: (v: string) => void; children: React.ReactNode; dim?: boolean; ariaLabel: string; style?: React.CSSProperties }) {
  return (
    <label style={{ position: "relative", display: "inline-flex", alignItems: "baseline", gap: 6, ...E.type.label11, color: dim ? E.color.inkMuted : E.color.ink, cursor: "pointer", whiteSpace: "nowrap", ...style }}>
      <span>{label}</span><span style={{ fontSize: 9 }}>▼</span>
      <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}>
        {children}
      </select>
    </label>
  );
}

export function TourWord({ onClick }: { onClick: () => void }) {
  return <div style={{ display: "flex", justifyContent: "center", margin: "60px 0 8px" }}><UnderlineWord onClick={onClick}>How does this room work? →</UnderlineWord></div>;
}

/** "You are here · S1 E3" — a mono rule between what you've reached and what waits. */
export function RoadRule({ text, ariaLabel }: { text: string; ariaLabel?: string }) {
  return (
    <div aria-label={ariaLabel} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", ...E.type.label10, letterSpacing: "0.1em", color: "rgba(26,58,74,0.55)" }}>
      <span style={{ flex: 1, height: 1, background: "rgba(26,58,74,0.25)" }} />
      <span style={{ textAlign: "center" }}>{text}</span>
      <span style={{ flex: 1, height: 1, background: "rgba(26,58,74,0.25)" }} />
    </div>
  );
}

/** The frame of a letter in the stream. `stamp` sits at the top-right; the
 *  head reserves it and is at least 74px tall. */
export function EntryShell({ stamp, stampReserve, head, children, onClick, dim = false, highlighted = false, chevron = false, headMinHeight, style }: {
  stamp?: React.ReactNode; stampReserve: number; head: React.ReactNode; children?: React.ReactNode; onClick?: (e: React.MouseEvent<HTMLDivElement>) => void; dim?: boolean; highlighted?: boolean;
  /** A closed letter's expand cue: the down chevron at the bottom right, in
   *  its own 10px of foot room so nothing runs under it. */
  chevron?: boolean;
  /** The head's clearance when the stamp is taller than the 74px default
   *  (Alborz 2026-10-13: the tall stamp ran into the preview). */
  headMinHeight?: number; style?: React.CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      style={{ position: "relative", padding: chevron ? "12px 0 26px" : "12px 0 16px", borderTop: `1px solid ${E.color.ink}`, borderBottom: `1px solid ${E.color.hairline}`, color: E.color.ink, opacity: dim ? 0.5 : 1, cursor: onClick ? "pointer" : "default", ...style }}
    >
      {/* The map-tap frame (Alborz's notes, round 5): the identity outline
          stands 12px clear of the words on both sides, drawn as its own
          layer so the letter never shifts. */}
      <span aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: -12, right: -12, border: `2px solid ${E.color.identity}`, pointerEvents: "none", opacity: highlighted ? 1 : 0, transition: "opacity 300ms ease", zIndex: 1 }} />
      {stamp && <span style={{ position: "absolute", top: 10, right: 0, display: "inline-block" }}>{stamp}</span>}
      <div style={{ minHeight: headMinHeight ?? E.space.stampClear, paddingRight: stampReserve, boxSizing: "border-box" }}>{head}</div>
      {children}
      {chevron && <ChevronDown size={16} color={E.color.ink} strokeWidth={1.5} aria-hidden="true" style={{ position: "absolute", right: 0, bottom: 6 }} />}
    </div>
  );
}

export const FROM_LINE: React.CSSProperties = { ...E.type.label11, letterSpacing: "0.06em", color: "rgba(26,58,74,0.7)" };
export const ENTRY_TITLE: React.CSSProperties = { ...E.type.letterTitle22, margin: "10px 0 8px" };
export const ENTRY_PREVIEW: React.CSSProperties = { ...E.type.letterBody15, lineHeight: 1.6 };

/** A sealed letter: FROM · SEALED UNTIL, one dim line, the lock on the stamp. */
export function SealedEntry({ from, until, line, stamp }: { from: string; until: string; line: string; stamp: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderTop: `1px solid ${E.color.ink}`, borderBottom: `1px solid ${E.color.hairline}`, color: E.color.ink }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={FROM_LINE}>From: {from} · Sealed until {until}</div>
        <div style={{ ...E.type.body14, lineHeight: 1.45, color: E.color.inkMuted, marginTop: 8 }}>{line}</div>
      </div>
      <span style={{ position: "relative", display: "inline-block", marginLeft: 18, flexShrink: 0 }}>{stamp}</span>
    </div>
  );
}

/** The letter from Sidebar's paper. `stack` = the pinned letter's sky offset. */
export function SidebarPaper({ children, stack = true, tone = "sky", style }: { children: React.ReactNode; stack?: boolean; /** The stack's colour: sky for a letter from Sidebar, alert for the room's welcome letter (Alborz's notes, round 2). */ tone?: "sky" | "alert"; style?: React.CSSProperties }) {
  return (
    <div role="note" aria-label="A letter from Sidebar" style={{ position: "relative", background: E.color.cream, border: `1px solid ${E.color.ink}`, boxShadow: stack ? (tone === "alert" ? `3px 3px 0 ${E.color.alert}` : E.shadow.sidebarLetter) : "none", padding: "16px 18px 14px", color: E.color.ink, boxSizing: "border-box", ...style }}>
      {children}
    </div>
  );
}

export function FrameButton({ children, onClick, style }: { children: React.ReactNode; onClick: () => void; style?: React.CSSProperties }) {
  return <button type="button" onClick={onClick} style={{ ...E.type.label11, height: 34, padding: "0 14px", border: `1px solid ${E.color.ink}`, background: "transparent", color: E.color.ink, display: "inline-flex", alignItems: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent", ...style }}>{children}</button>;
}

/** The guide's cast row: a 48px photo (or a draft square), the actor, the role. */
export function CastRow({ img, name, role, onClick }: { img?: string | null; name: string; role?: string | null; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} title={onClick ? `${name} on IMDb` : undefined} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", padding: "10px 0", background: "transparent", border: 0, borderBottom: `1px solid ${E.color.hairline}`, textAlign: "left", cursor: onClick ? "pointer" : "default", color: E.color.ink, fontFamily: E.font.interface, WebkitTapHighlightColor: "transparent" }}>
      {img
        ? <img src={img} alt="" loading="lazy" style={{ width: 48, height: 48, objectFit: "cover", display: "block", flexShrink: 0 }} />
        : <span aria-hidden="true" style={{ width: 48, height: 48, background: E.color.draft, display: "block", flexShrink: 0 }} />}
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2, ...E.type.note13 }}>
        <span style={{ fontWeight: 600 }}>{name}</span>
        {role && <span style={{ color: E.color.inkMuted }}>{role}</span>}
      </span>
    </button>
  );
}

/** The guide's episode row: a mono number, the title, and the state at the right. */
export function EpisodeRow({ n, title, state, children }: { n: number; title: string; state: "watched" | "here" | "ahead"; children?: React.ReactNode }) {
  const dimmed = state === "ahead";
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "10px 0", borderBottom: `1px solid ${E.color.hairline}`, ...E.type.body14, color: dimmed ? "rgba(26,58,74,0.45)" : E.color.ink }}>
      <span style={{ ...E.type.label10, color: dimmed ? "rgba(26,58,74,0.45)" : E.color.inkMuted, minWidth: 22 }}>{String(n).padStart(2, "0")}</span>
      <span style={{ fontWeight: state === "here" ? 600 : 400, minWidth: 0, flex: 1 }}>{title}</span>
      {children}
      <span style={{ ...E.type.label10, marginLeft: "auto", color: state === "watched" ? E.color.inkMuted : "inherit", whiteSpace: "nowrap" }}>{state === "watched" ? "Watched" : state === "here" ? "You are here" : "After you watch it"}</span>
    </div>
  );
}

/** A draft's row: the Lora title, "Draft · S1 E3 · edited yesterday", the first line. */
export function DraftRow({ title, meta, line, onClick }: { title: string | null; meta: string; line?: string | null; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" onClick={onClick} style={{ display: "block", width: "100%", padding: "14px 0", background: "transparent", border: 0, borderBottom: `1px solid ${E.color.hairline}`, textAlign: "left", cursor: "pointer", color: E.color.ink, WebkitTapHighlightColor: "transparent" }}>
      <div style={{ ...E.type.letterTitle22, fontSize: 20, color: title ? E.color.ink : "rgba(26,58,74,0.55)" }}>{title || "Untitled"}</div>
      <div style={{ ...FROM_LINE, marginTop: 6 }}>{meta}</div>
      {line && <div style={{ ...E.type.letterBody15, fontSize: 14, marginTop: 8, color: "rgba(26,58,74,0.75)" }}>{line}</div>}
    </button>
  );
}

/** A room's "N responses · Write back →" foot, or the counts alone. */
export function EntryFoot({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${E.color.hairline}`, ...E.type.label11, letterSpacing: "0.06em", color: E.color.inkMuted }}>
      <span>{left}</span>{right}
    </div>
  );
}
