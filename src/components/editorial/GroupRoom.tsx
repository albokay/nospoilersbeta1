/**
 * GroupRoom.tsx — the editorial group room's pieces (checkpoint 3,
 * 2026-10-12; the E3Group / D3Group / E3Stance / D3Stance boards and the
 * bible's ListRow, EnvelopeDisc, StanceCard, Sheet, Buttons). Rendered under
 * the editorial skin only, by MobileGroupRoom and DashboardPage; the classic
 * room is untouched.
 *
 *   Masthead        the sky swath behind the room's head.
 *   OpenRoomsDisc   the cream disc with the count of open rooms.
 *   ShowRow         a hairline row: 40×56 poster, the name, a mono second
 *                   line, one thing at the end. On the phone a row with
 *                   options slides left over an accent drawer with the pen
 *                   and a full swipe opens them; a 4px accent edge at the
 *                   row's end is the drawer showing through. On desktop the
 *                   pen appears on hover and opens the same options.
 *   AnswerRow       the three (or two) answers on one connected hairline
 *                   row; the chosen one filled accent and ringed accent.
 *   NumbersPicker   WATCHED · the season with its dropdown · the numbers
 *                   row (watched = ink, yours = bold with a 2px underline,
 *                   the rest faint). Zero is "haven't started".
 *   StanceSurface   the stance card's content, fed a view model by the host.
 *   EditorialSheet / EditorialDialog   the phone's sheet from the title line
 *                   and the desktop's centred card on the veil.
 *   OptionsSheet / OptionsDialog       the Sheet with its rows (and Cancel).
 */
import React, { useEffect, useRef, useState } from "react";
import { SquarePen } from "lucide-react";
import { E } from "../../styles/editorial";
import { fetchTvmazePoster } from "../../lib/tvmaze";
import useSheetSwipeDown from "../../lib/useSheetSwipeDown";
import TrailerCard from "../TrailerCard";
import { joinNames } from "../../lib/groupNames";

/** The room's paper note: a readable letter first, then a sealed one, then
 *  chat; null when nothing waits. The rooms are the shelves' rows. */
export function groupRoomNote(rooms: { roomId: string | null; name: string }[], dots: Map<string, "blue" | "red">, chatNew: boolean): { text: string; at: number } | null {
  const seen = new Set<string>();
  const named = (kind: "blue" | "red") => rooms.filter((r) => r.roomId && dots.get(r.roomId) === kind && !seen.has(r.name) && seen.add(r.name)).map((r) => r.name);
  const blue = named("blue");
  if (blue.length) return { text: blue.length === 1 ? `A letter is waiting for you in ${blue[0]}.` : `Letters are waiting in ${joinNames(blue)}.`, at: 0 };
  const red = named("red");
  if (red.length) return { text: red.length === 1 ? `A sealed letter is waiting in ${red[0]}.` : `Sealed letters are waiting in ${joinNames(red)}.`, at: 0 };
  if (chatNew) return { text: "Something new in the chat.", at: 0 };
  return null;
}

export function Masthead({ height }: { height: number | string }) {
  return <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height, background: E.color.friend, zIndex: 0 }} />;
}

export function OpenRoomsDisc({ count, desktop = false, style }: { count: number; desktop?: boolean; style?: React.CSSProperties }) {
  const size = desktop ? E.measure.desktop.disc : E.measure.phone.disc;
  return (
    <div aria-label={`${count} open room${count === 1 ? "" : "s"}`} style={{ position: "absolute", width: size, height: size, borderRadius: "50%", background: E.color.cream, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 2, color: E.color.ink, ...style }}>
      <span style={{ ...E.type.label9, fontSize: 8, letterSpacing: "0.12em" }}>Open rooms</span>
      <span style={{ ...E.type.disc30, fontSize: desktop ? 34 : 30, marginTop: 3 }}>{count}</span>
    </div>
  );
}

/** The poster for a row, from the module-cached TVMaze lookup. */
function usePoster(tvmazeId?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!tvmazeId) { setUrl(null); return; }
    fetchTvmazePoster(tvmazeId).then((u) => { if (!cancelled) setUrl(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [tvmazeId]);
  return url;
}

export function RowPoster({ tvmazeId, w = 40, h = 56 }: { tvmazeId?: string | null; w?: number; h?: number }) {
  const url = usePoster(tvmazeId);
  return url
    ? <img src={url} alt="" loading="lazy" draggable={false} style={{ width: w, height: h, objectFit: "cover", display: "block", flexShrink: 0 }} />
    : <span aria-hidden="true" style={{ display: "block", width: w, height: h, background: E.color.draft, flexShrink: 0 }} />;
}

const PEN = <SquarePen size={22} strokeWidth={1.8} color={E.color.ink} aria-hidden="true" />;

const SWIPE_OPEN = 96;   // the board's open state
const SWIPE_COMMIT = 60; // past this, letting go opens the options

/** The hint key: the first visit slides the top row open and back once. */
export function swipeHintKey(uid: string) { return `ns_swipe_hint_${uid}`; }

export function ShowRow({ tvmazeId, poster = true, name, nameSize = 17, line, end, onOpen, onOptions, optionsLabel = "Options for this show", desktop = false, padding, hint = false, dashed = false }: {
  tvmazeId?: string | null;
  /** false = a pitched row (no poster). */
  poster?: boolean;
  name: string;
  nameSize?: 16 | 17;
  line?: React.ReactNode;
  end?: React.ReactNode;
  onOpen: () => void;
  /** The row's options (the leave / clear sheet). With one, the phone row
   *  swipes and the desktop row grows a pen on hover. */
  onOptions?: () => void;
  optionsLabel?: string;
  desktop?: boolean;
  padding?: string;
  /** Slide open and back once (the first visit's hint). */
  hint?: boolean;
  /** A proposal you passed on: the name in ink-muted. */
  dashed?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; axis: "x" | "y" | null } | null>(null);
  const [hinting, setHinting] = useState(hint);
  useEffect(() => { if (hint) { const t = window.setTimeout(() => setHinting(false), 1400); return () => window.clearTimeout(t); } }, [hint]);

  const text = (
    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: poster ? 5 : 4 }}>
      <span style={{ ...(nameSize === 17 ? E.type.row17 : E.type.row16), color: dashed ? E.color.inkMuted : E.color.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      {line && <span style={{ ...E.type.label11, letterSpacing: "0.04em", color: E.color.inkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line}</span>}
    </span>
  );
  const rowStyle: React.CSSProperties = {
    position: "relative", display: "flex", alignItems: "center", gap: 16, width: "100%", boxSizing: "border-box",
    padding: padding ?? (poster ? "16px 0" : "14px 0"), background: "transparent", border: 0, borderBottom: `1px solid ${E.color.hairline}`,
    color: E.color.ink, textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent", fontFamily: E.font.interface,
  };

  if (desktop) {
    return (
      <button type="button" className="e-row" onClick={onOpen} style={rowStyle}>
        {poster && <RowPoster tvmazeId={tvmazeId} />}
        {onOptions && (
          <span
            className="e-pen" role="button" aria-label={optionsLabel} title={optionsLabel}
            onClick={(e) => { e.stopPropagation(); onOptions(); }}
            style={{ position: "absolute", right: 150, top: "50%", transform: "translateY(-50%)", width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: 0, zIndex: 1 }}
          >
            <SquarePen size={16} strokeWidth={1.5} color={E.color.ink} aria-hidden="true" />
          </span>
        )}
        {text}
        {end}
      </button>
    );
  }

  // The phone: the row rides over the accent drawer. Horizontal drags move
  // it (vertical ones scroll the page); past SWIPE_COMMIT a release opens the
  // options; the revealed pen opens them too; a plain tap opens the room.
  const gutter = E.space.gutter;
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onOptions) return;
    start.current = { x: e.clientX, y: e.clientY, axis: null };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = start.current;
    if (!st) return;
    const mx = e.clientX - st.x, my = e.clientY - st.y;
    if (st.axis === null) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      st.axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      if (st.axis === "x") { setDragging(true); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ } }
    }
    if (st.axis === "x") setDx(Math.max(-SWIPE_OPEN - 24, Math.min(0, mx)));
  };
  const onUp = () => {
    const st = start.current;
    start.current = null;
    if (!st || st.axis !== "x") return;
    const commit = dx < -SWIPE_COMMIT;
    setDragging(false);
    setDx(0);
    if (commit) onOptions?.();
  };
  const shift = hinting ? -SWIPE_OPEN : dx;
  return (
    <div
      style={{ position: "relative", overflow: "hidden", margin: `0 -${gutter}px`, borderBottom: `1px solid ${E.color.hairline}`, touchAction: "pan-y" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
    >
      {onOptions && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: E.color.accent, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 30 }}>
          <span role="button" aria-label={optionsLabel} onClick={() => onOptions()} style={{ display: "inline-flex", width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>{PEN}</span>
        </div>
      )}
      <button
        type="button"
        onClick={() => { if (!dragging && dx === 0) onOpen(); }}
        style={{ ...rowStyle, borderBottom: 0, padding: padding ?? (poster ? `16px ${gutter}px` : `14px ${gutter}px`), background: E.color.cream, transform: `translateX(${shift}px)`, transition: dragging ? "none" : "transform 260ms ease" }}
      >
        {poster && <RowPoster tvmazeId={tvmazeId} />}
        {text}
        {end}
        {onOptions && <span aria-hidden="true" style={{ position: "absolute", right: 0, top: 6, bottom: 6, width: 4, background: E.color.accent }} />}
      </button>
    </div>
  );
}

/** The hover rule for the desktop rows' pens. Mount once per page. */
export function RowHoverStyle() {
  return <style>{`.e-row .e-pen{opacity:0}.e-row:hover .e-pen{opacity:1}`}</style>;
}

export function AnswerRow<T extends string | boolean>({ options, value, onChange, label = "Your answer" }: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", marginTop: 16, border: `1px solid ${E.color.ink}` }}>
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button
            key={String(o.value)} type="button" role="radio" aria-checked={on}
            onClick={(e) => { e.stopPropagation(); if (!on) onChange(o.value); }}
            style={{
              flex: 1, height: 46, boxSizing: "border-box", ...E.type.label11, color: E.color.ink, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
              background: on ? E.color.accent : "transparent", border: 0, borderLeft: i > 0 && !on ? `1px solid ${E.color.ink}` : 0, padding: "0 4px", cursor: "pointer",
              ...(on ? { boxShadow: `0 0 0 2px ${E.color.accent}`, position: "relative", zIndex: 1, fontWeight: 500 } : {}),
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function NumbersPicker({ show, value, onChange, allowZero = true }: {
  show: { seasons?: number[] } | null | undefined;
  value: { s: number; e: number };
  onChange: (v: { s: number; e: number }) => void;
  allowZero?: boolean;
}) {
  const seasons = show?.seasons ?? [];
  if (seasons.length === 0) return <div style={{ ...E.type.label11, color: E.color.inkMuted, marginTop: 12 }}>loading episodes…</div>;
  const season = Math.min(Math.max(value.s, 1), seasons.length);
  const count = seasons[season - 1] ?? 0;
  const nums: number[] = [];
  if (allowZero && season === 1) nums.push(0);
  for (let i = 1; i <= count; i++) nums.push(i);
  const current = value.s === 0 ? 0 : value.s === season ? value.e : -1;
  return (
    <>
      <div style={{ ...E.type.label11, marginTop: 12, display: "flex", justifyContent: "center", gap: 14, alignItems: "baseline", color: E.color.ink }}>
        <span style={{ opacity: 0.7 }}>Watched</span>
        <label style={{ position: "relative", display: "inline-flex", alignItems: "baseline", gap: 6, cursor: "pointer" }}>
          <span>Season {season}</span><span style={{ fontSize: 9 }}>▼</span>
          <select
            aria-label="Season" value={season}
            onChange={(e) => { const s = Number(e.target.value); onChange({ s, e: Math.min(Math.max(1, value.s === s ? value.e : 1), seasons[s - 1] ?? 1) }); }}
            style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
          >
            {seasons.map((_, i) => <option key={i + 1} value={i + 1}>Season {i + 1}</option>)}
          </select>
        </label>
      </div>
      <div aria-label="Episode" style={{ marginTop: 10, display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", gap: "6px 11px" }}>
        {nums.map((n) => {
          const me = n === current;
          const watched = n === 0 ? false : value.s > season || (value.s === season && n <= value.e);
          return (
            <button
              key={n} type="button" aria-pressed={me} aria-label={n === 0 ? "Haven't started" : `Episode ${n}`}
              onClick={() => onChange(n === 0 ? { s: 0, e: 0 } : { s: season, e: n })}
              style={{ ...E.type.numbers22, background: "transparent", border: 0, padding: "2px 1px", cursor: "pointer", color: me || watched ? E.color.ink : E.color.inkFaint, fontWeight: me ? 700 : 600, borderBottom: me ? `2px solid ${E.color.ink}` : "2px solid transparent", lineHeight: 1.1, minWidth: 18, WebkitTapHighlightColor: "transparent" }}
            >
              {n}
            </button>
          );
        })}
      </div>
    </>
  );
}

export type StanceView = {
  name: string;
  question: string | null;
  /** "Sam is in. Priya has already seen it." lines. */
  answerLines: string[];
  answer: { kind: "stance"; value: "in" | "out" | "seen" | null; onChange: (v: "in" | "out" | "seen") => void } | { kind: "yesno"; value: boolean; onChange: (v: boolean) => void } | null;
  progress: { title: string | null; note: string | null; show: { seasons?: number[] } | null | undefined; value: { s: number; e: number }; onChange: (v: { s: number; e: number }) => void } | null;
  actions: { readLine: string | null; enterLabel: string; onEnter: () => void; joinNote: string | null; onJustConfirm: (() => void) | null } | null;
  trailer: { showId: string; tvmazeId?: string | null } | null;
};

export function StanceSurface({ view, inset }: { view: StanceView; inset: number }) {
  return (
    <div style={{ textAlign: "center", color: E.color.ink }}>
      <div style={{ ...E.type.question30, fontSize: 34, lineHeight: 1.05, letterSpacing: "-0.01em", marginTop: 26 }}>{view.name}</div>
      {view.question && <div style={{ ...E.type.label11, marginTop: 22 }}>{view.question}</div>}
      {view.answerLines.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.45, color: "rgba(26,58,74,0.7)" }}>{view.answerLines.join(" ")}</div>
      )}
      {view.answer && (view.answer.kind === "stance" ? (
        <AnswerRow options={[{ value: "in", label: "I'm in" }, { value: "out", label: "Sit this out" }, { value: "seen", label: "I've seen it" }]} value={view.answer.value} onChange={view.answer.onChange} />
      ) : (
        <AnswerRow options={[{ value: true, label: "Yes" }, { value: false, label: "No" }]} value={view.answer.value} onChange={view.answer.onChange} />
      ))}
      {view.progress && (
        <div style={{ margin: `24px -${inset}px 0`, padding: `16px ${inset}px 18px`, background: E.color.personal }}>
          {view.progress.title && <div style={E.type.label11}>{view.progress.title}</div>}
          {view.progress.note && <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.45, color: "rgba(26,58,74,0.75)" }}>{view.progress.note}</div>}
          <NumbersPicker show={view.progress.show} value={view.progress.value} onChange={view.progress.onChange} />
        </div>
      )}
      {view.actions && (
        <>
          {view.actions.readLine && <div style={{ ...E.type.label11, marginTop: 22 }}>{view.actions.readLine}</div>}
          <button type="button" onClick={view.actions.onEnter} style={{ ...E.type.button16, marginTop: view.actions.readLine ? 12 : 24, width: "100%", height: 56, background: E.color.ink, color: E.color.cream, border: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            {view.actions.enterLabel}
          </button>
          {view.actions.joinNote && <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.45, color: "rgba(26,58,74,0.75)" }}>{view.actions.joinNote}</div>}
          {view.actions.onJustConfirm && (
            <button type="button" onClick={view.actions.onJustConfirm} style={{ ...E.type.label11, marginTop: 14, background: "transparent", border: 0, padding: "8px 0", color: E.color.ink, textDecoration: "underline", textUnderlineOffset: 2, cursor: "pointer" }}>
              Just confirm my progress
            </button>
          )}
        </>
      )}
      {view.trailer && (
        <div style={{ marginTop: 22, display: "flex", justifyContent: "center" }}>
          <TrailerCard showId={view.trailer.showId} tvmazeId={view.trailer.tvmazeId} />
        </div>
      )}
    </div>
  );
}

/** The phone's sheet: the veil, the cream panel from the title line down,
 *  the grabber; swipe down or tap the veil to close. */
export function EditorialSheet({ onClose, top = 96, children }: { onClose: () => void; top?: number; children: React.ReactNode }) {
  // The sheet starts below the phone's status bar (Alborz's notes, 2026-10-12).
  const scrollRef = useRef<HTMLDivElement>(null);
  const swipe = useSheetSwipeDown(onClose, { open: true, scrollRef });
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: E.color.veil, animation: "mDimIn 180ms ease-out" }} />
      <div
        ref={scrollRef}
        {...swipe.handlers}
        style={{ position: "absolute", left: 0, right: 0, top: E.safe.plus(top), bottom: 0, background: E.color.cream, padding: `10px ${E.space.gutter}px calc(env(safe-area-inset-bottom, 0px) + 32px)`, boxSizing: "border-box", overflowY: "auto", WebkitOverflowScrolling: "touch", animation: "mSheetRise 180ms ease-out", ...swipe.style }}
      >
        <div aria-hidden="true" style={{ width: 36, height: 4, background: E.color.ink, margin: "0 auto" }} />
        {children}
      </div>
    </div>
  );
}

/** The desktop's centred card on the veil, the deck's card with a × at its corner. */
export function EditorialDialog({ onClose, width = 480, label, align = "center", children }: { onClose: () => void; width?: number; label?: string; align?: "center" | "left"; children: React.ReactNode }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 1100, background: E.color.veil, overflowY: "auto" }}>
      <div role="dialog" aria-label={label} style={{ position: "relative", width, maxWidth: "92vw", margin: "72px auto 48px", boxSizing: "border-box", background: E.color.cream, boxShadow: E.shadow.cardStack, padding: "30px 32px 32px", textAlign: align, color: E.color.ink }}>
        <button type="button" aria-label="Close" title="Close" onClick={onClose} style={{ position: "absolute", right: 12, top: 10, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20, lineHeight: 1, background: "transparent", border: 0, padding: 0, cursor: "pointer", color: E.color.ink }}>×</button>
        {children}
      </div>
    </div>
  );
}

export type OptionRow = { label: string; sub?: string; tone?: "alert" | "identity" | "ink"; onClick: () => void };

function OptionRows({ rows }: { rows: OptionRow[] }) {
  const tone = (t?: OptionRow["tone"]) => (t === "alert" ? E.color.alert : t === "identity" ? E.color.identity : E.color.ink);
  return (
    <>
      {rows.map((r, i) => (
        <button key={i} type="button" onClick={r.onClick} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, width: "100%", padding: "14px 0", background: "transparent", border: 0, borderBottom: i < rows.length - 1 ? `1px solid ${E.color.hairline}` : 0, textAlign: "left", cursor: "pointer", fontFamily: E.font.interface, WebkitTapHighlightColor: "transparent" }}>
          <span style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3, color: tone(r.tone) }}>{r.label}</span>
          {r.sub && <span style={{ fontSize: 13, lineHeight: 1.45, color: E.color.inkMuted }}>{r.sub}</span>}
        </button>
      ))}
    </>
  );
}

/** The phone's bottom sheet with rows: the show's options. */
export function OptionsSheet({ title, caption, rows, onClose }: { title: string; caption?: string; rows: OptionRow[]; onClose: () => void }) {
  const swipe = useSheetSwipeDown(onClose, { open: true });
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: E.color.veil, animation: "mDimIn 180ms ease-out" }} />
      <div {...swipe.handlers} style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: E.color.cream, padding: "10px 20px calc(env(safe-area-inset-bottom, 0px) + 20px)", boxSizing: "border-box", animation: "mSheetRise 180ms ease-out", color: E.color.ink, ...swipe.style }}>
        <div aria-hidden="true" style={{ width: 36, height: 4, background: E.color.ink, margin: "0 auto 14px" }} />
        <div style={E.type.letterTitle22}>{title}</div>
        {caption && <div style={{ ...E.type.label11, color: E.color.inkMuted, margin: "4px 0 8px" }}>{caption}</div>}
        <OptionRows rows={rows} />
      </div>
    </div>
  );
}

/** The desktop's dialog with the same rows and a Cancel frame. */
export function OptionsDialog({ title, caption, rows, onClose }: { title: string; caption?: string; rows: OptionRow[]; onClose: () => void }) {
  return (
    <EditorialDialog onClose={onClose} width={420} label={title} align="left">
      <div style={{ ...E.type.letterTitle22, paddingRight: 28 }}>{title}</div>
      {caption && <div style={{ ...E.type.label11, color: E.color.inkMuted, margin: "4px 0 8px" }}>{caption}</div>}
      <OptionRows rows={rows} />
      <button type="button" onClick={onClose} style={{ ...E.type.button16, marginTop: 20, width: "100%", height: 54, border: `1px solid ${E.color.ink}`, background: "transparent", color: E.color.ink, cursor: "pointer", boxSizing: "border-box" }}>Cancel</button>
    </EditorialDialog>
  );
}
