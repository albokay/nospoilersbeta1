/**
 * Onboarding.tsx — the editorial pieces of the deck and the onboarding
 * (checkpoint 7, 2026-10-12; the E3Deck / D3Deck, E3Onb* / D3Onb*, E3Inv* /
 * D3Inv* boards and the bible's QuestionCard, Steps and Form). The hosts
 * keep their state and calls; these draw them: the step bars, the ink
 * wordmark, the question, the pick and progress bands, the Show field, the
 * poster strips, the friend rows, the link rows, the blocks.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { E } from "../../styles/editorial";
import { useBrowseRows } from "../BrowseRows";
import type { BrowseShow, Show } from "../../lib/db";
import { tvmazeSearch, networkLabel, slugify, type TVmazeShow } from "../../lib/tvmaze";
import { RowPoster, NumbersPicker } from "./GroupRoom";
import { UnderlineWord, SectionHead } from "./Chrome";

/** A full-screen page on cream. */
export function pageStyle(zIndex: number, extra?: React.CSSProperties): React.CSSProperties {
  return { position: "fixed", inset: 0, zIndex, background: E.color.cream, color: E.color.ink, overflowY: "auto", WebkitOverflowScrolling: "touch", fontFamily: E.font.interface, boxSizing: "border-box", ...extra };
}
/** The desktop column: 672 wide, centred. */
export const COLUMN: React.CSSProperties = { width: E.measure.desktop.letters, maxWidth: "calc(100% - 48px)", margin: "0 auto", boxSizing: "border-box" };
/** Where the desktop boards put the step bars and the minimize: 80px right of the column. */
export const RIGHT_OF_COLUMN = "max(24px, calc(50% - 456px))";

/** The claw-back from theme.ts's global input paint, for the fields below. */
export const FORM_CSS = `
  .e-field { background-color: transparent !important; background-image: none !important; color: ${E.color.ink} !important; border-radius: 0 !important; box-shadow: none !important; }
  .e-field::placeholder { color: rgba(26,58,74,0.45) !important; opacity: 1 !important; }
  .e-field:read-only { opacity: 0.7; }
  .e-strip::-webkit-scrollbar { display: none; }
`;

/** The step counter: three 22×4 bars, outlined ink, filled as they're done (the current one too). */
export function StepsBars({ step, total = 3, style }: { step: number; total?: number; style?: React.CSSProperties }) {
  return (
    <span aria-label={`Signup step ${step} of ${total}`} style={{ display: "inline-flex", gap: 6, ...style }}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} style={{ display: "block", width: 22, height: 4, boxSizing: "border-box", border: `1px solid ${E.color.ink}`, background: i < step ? E.color.ink : "transparent" }} />
      ))}
    </span>
  );
}

/** The "sidebar" wordmark alone, as a solid fill of one colour. */
export function Wordmark({ height = 26, color = E.color.ink, style }: { height?: number; color?: string; style?: React.CSSProperties }) {
  return (
    <span aria-label="sidebar" role="img" style={{ display: "block", height, width: Math.round(height * 3.17), background: color, WebkitMaskImage: "url(/sidebar-logo.png)", maskImage: "url(/sidebar-logo.png)", WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center", ...style }} />
  );
}

/** A block (the one act) and a frame (the second act), 56px. */
export function Block({ children, onClick, disabled = false, type = "button", style }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit"; style?: React.CSSProperties }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...E.type.button16, width: "100%", height: 56, background: E.color.ink, color: E.color.cream, border: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, boxSizing: "border-box", ...style }}>
      {children}
    </button>
  );
}
export function Frame({ children, onClick, disabled = false, style }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; style?: React.CSSProperties }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...E.type.button16, width: "100%", height: 56, background: "transparent", color: E.color.ink, border: `1px solid ${E.color.ink}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, boxSizing: "border-box", ...style }}>
      {children}
    </button>
  );
}

/** The step's question in Lora with its one-line sub. */
export function OnbQuestion({ children, sub, align = "center", desktop = false, style }: { children: React.ReactNode; sub?: React.ReactNode; align?: "center" | "left"; desktop?: boolean; style?: React.CSSProperties }) {
  return (
    <div style={{ textAlign: align, ...style }}>
      <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: desktop ? 34 : 30, lineHeight: 1.15, letterSpacing: "-0.01em", color: E.color.ink }}>{children}</div>
      {sub && <div style={{ ...E.type.note13, fontSize: desktop ? 14 : 13, color: "rgba(26,58,74,0.72)", marginTop: 10 }}>{sub}</div>}
    </div>
  );
}

/** A band across the page: the phone bleeds past the gutter; desktop runs across the window with the column inside. */
export function Band({ color, children, desktop = false, inset = E.space.gutter, inner, style }: { color: string; children: React.ReactNode; desktop?: boolean; /** The host's side padding the band bleeds past (the page gutter; a dialog's own). */ inset?: number; inner?: React.CSSProperties; style?: React.CSSProperties }) {
  return desktop ? (
    <div style={{ background: color, padding: "28px 0", ...style }}><div style={{ ...COLUMN, ...inner }}>{children}</div></div>
  ) : (
    <div style={{ margin: `0 -${inset}px`, padding: `20px ${inset}px 22px`, background: color, ...style }}><div style={inner}>{children}</div></div>
  );
}

/** YOUR PICK on the accent band: the poster, the name, the seasons, "Pick a different show". */
export function PickBand({ show, onChangePick, desktop = false, inset, style }: { show: Show; onChangePick: () => void; desktop?: boolean; inset?: number; style?: React.CSSProperties }) {
  const n = show.seasons?.length ?? 0;
  const meta = [show.status === "Running" || show.status === "In Development" ? "Returning" : null, n ? `${n} season${n === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  return (
    <Band color={E.color.accent} desktop={desktop} inset={inset} style={style}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", ...E.type.label11, color: E.color.ink }}>
        <span>Your pick</span>
        <UnderlineWord onClick={onChangePick}>Pick a different show</UnderlineWord>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
        <RowPoster tvmazeId={show.tvmazeId} w={48} h={68} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: E.font.interface, fontWeight: 600, fontSize: 18, letterSpacing: "-0.01em", color: E.color.ink }}>{show.name}</span>
          {meta && <span style={{ display: "block", ...E.type.label10, letterSpacing: "0.04em", color: E.color.inkMuted, marginTop: 4 }}>{meta}</span>}
        </span>
      </div>
    </Band>
  );
}

/** "Have you started watching?" on the personal band, with the numbers. */
export function ProgressBand({ show, value, onChange, desktop = false, inset = E.space.gutter, style }: { show: Show; value: { s: number; e: number }; onChange: (v: { s: number; e: number }) => void; desktop?: boolean; inset?: number; style?: React.CSSProperties }) {
  return (
    <Band color={E.color.personal} desktop={desktop} inset={inset} style={{ textAlign: "center", ...(desktop ? { padding: "16px 0 18px" } : { padding: `16px ${inset}px 18px` }), ...style }}>
      <div style={{ ...E.type.label11, color: E.color.ink }}>Have you started watching?</div>
      <NumbersPicker show={show} value={value} onChange={onChange} />
    </Band>
  );
}

/** A form field: a mono label, then an underline in ink the text sits on. */
/** The field (Alborz's notes, round 4, his option A): a box — a 1px ink
 *  frame, 44 tall, no fill (on the yellow band the band shows through) —
 *  with its short mono label inside ("Name:", "Show:"). A section head is a
 *  rule; a field is a box, so the two never read alike. */
export const FIELD_BOX: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, height: 44, padding: "0 12px", boxSizing: "border-box", border: `1px solid ${E.color.ink}`, ...E.type.label11, color: E.color.ink };
export const FIELD_INPUT: React.CSSProperties = { flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontFamily: E.font.interface, fontSize: 16, fontWeight: 400, color: E.color.ink, textTransform: "none", letterSpacing: 0, padding: 0, margin: 0 };

export function Field({ label, value, onChange, placeholder, type = "text", inputMode, autoComplete, autoCapitalize, autoCorrect, readOnly = false, autoFocus = false, maxLength, style, inputStyle }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string; autoCapitalize?: string; autoCorrect?: string; readOnly?: boolean; autoFocus?: boolean; maxLength?: number; style?: React.CSSProperties; inputStyle?: React.CSSProperties;
}) {
  const tag = label.replace(/:\s*$/, "") + ":";
  return (
    <label style={{ ...FIELD_BOX, ...style }}>
      <span style={{ flexShrink: 0 }}>{tag}</span>
      <input
        className="e-field" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode} autoComplete={autoComplete} autoCapitalize={autoCapitalize} autoCorrect={autoCorrect} readOnly={readOnly} autoFocus={autoFocus} maxLength={maxLength} aria-label={label}
        style={{ ...FIELD_INPUT, ...inputStyle }}
      />
    </label>
  );
}

/** A field with its mono label inside, on one rule — the Show field's shape
 *  (Alborz's notes, round 3, his option A for the friends' rows). */
export function InlineField(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoCapitalize?: string; autoCorrect?: string; maxLength?: number; autoFocus?: boolean; style?: React.CSSProperties }) {
  // The same box as Field (round 4), with the browser's autofill off.
  return <Field {...props} autoComplete="off" />;
}

/** The friends' rows: a name and an email on one rule, "Add another friend" under them. */
export function FriendRows({ rows, onChange, onAdd, max = 7, desktop = false }: { rows: { name: string; email: string }[]; onChange: (i: number, field: "name" | "email", v: string) => void; onAdd: () => void; max?: number; desktop?: boolean }) {
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: desktop ? 24 : 16, marginTop: i === 0 ? 0 : 22 }}>
          <InlineField label="Name:" value={r.name} onChange={(v) => onChange(i, "name", v)} placeholder="Sam" maxLength={40} style={{ flex: 1, minWidth: 0 }} />
          <InlineField label="Email:" value={r.email} onChange={(v) => onChange(i, "email", v)} placeholder="sam@example.com" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" style={{ flex: 1.4, minWidth: 0 }} />
        </div>
      ))}
      {rows.length < max && (
        <div style={{ marginTop: 18, textAlign: "center" }}><UnderlineWord onClick={onAdd}>Add another friend</UnderlineWord></div>
      )}
    </div>
  );
}

/** "Show:" and a field on one rule; the matches (Sidebar's catalog, then TVMaze) as hairline rows under it. */
export function ShowField({ shows, onPickShow, onPickTv, busy = false, excludeSlugs, label = "Show:", placeholder = "find your show", autoFocus = false, style }: {
  shows: Show[]; onPickShow: (s: Show) => void; onPickTv: (tv: TVmazeShow) => void; busy?: boolean; excludeSlugs?: Set<string>; label?: string; placeholder?: string; autoFocus?: boolean; style?: React.CSSProperties;
}) {
  const [query, setQuery] = useState("");
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const deb = useRef<number | null>(null);
  const catalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shows.filter((s) => !s.isHidden && s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, shows]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setTvResults([]); return; }
    if (deb.current) window.clearTimeout(deb.current);
    let cancelled = false;
    deb.current = window.setTimeout(async () => {
      try { const r = await tvmazeSearch(q); if (!cancelled) setTvResults(r); } catch { if (!cancelled) setTvResults([]); }
    }, 320);
    return () => { cancelled = true; if (deb.current) window.clearTimeout(deb.current); };
  }, [query]);
  const tvToAdd = useMemo(() => {
    const known = new Set(shows.map((s) => s.id));
    const seen = new Set<string>();
    const out: { tv: TVmazeShow; id: string }[] = [];
    for (const tv of tvResults) {
      const id = slugify(tv.name);
      if (known.has(id) || seen.has(id) || excludeSlugs?.has(id)) continue;
      seen.add(id);
      out.push({ tv, id });
      if (out.length >= 8) break;
    }
    return out;
  }, [tvResults, shows, excludeSlugs]);
  const reset = () => { setQuery(""); setTvResults([]); };
  const searching = query.trim().length >= 2 && catalog.length === 0 && tvToAdd.length === 0;
  const row: React.CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: `1px solid ${E.color.hairline}`, padding: "12px 0", cursor: "pointer", color: E.color.ink, fontFamily: E.font.interface, fontWeight: 600, fontSize: 15 };
  return (
    <div style={style}>
      <label style={FIELD_BOX}>
        <span style={{ flexShrink: 0 }}>{label}</span>
        <input className="e-field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} aria-label="Find a show" autoComplete="off" style={FIELD_INPUT} />
      </label>
      {(catalog.length > 0 || tvToAdd.length > 0) && (
        <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 4 }}>
          {catalog.map((s) => (
            <button key={s.id} type="button" style={row} onClick={() => { onPickShow(s); reset(); }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            </button>
          ))}
          {tvToAdd.map(({ tv, id }) => (
            <button key={id} type="button" style={row} disabled={busy} onClick={() => { onPickTv(tv); reset(); }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tv.name}</span>
              {networkLabel(tv) && <span style={{ ...E.type.label10, color: E.color.inkMuted, flexShrink: 0 }}>{networkLabel(tv)}</span>}
            </button>
          ))}
        </div>
      )}
      {searching && <div style={{ ...E.type.label10, color: E.color.inkMuted, padding: "12px 0" }}>{busy ? "adding…" : "searching…"}</div>}
    </div>
  );
}

function stripTitle(key: string, title: string): string {
  if (key === "popular") return "Popular right now";
  if (key === "starting_up") return "Returning this month";
  return title.replace(/:\s*$/, "");
}

/** One strip: the mono title (with the desktop's arrows at its right) over a scrolling row of tiles. */
function StripRow({ title, shows, onPick, action, desktop, size, bleed }: { title: string; shows: BrowseShow[]; onPick: (s: BrowseShow) => void; action: string; desktop: boolean; size: "thumb" | "tile"; bleed: number }) {
  const w = size === "tile" ? 104 : 72;
  const h = size === "tile" ? 148 : 104;
  const gap = desktop ? (size === "tile" ? 24 : 28) : (size === "tile" ? 16 : 14);
  const scroller = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  function measure() {
    const el = scroller.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }
  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shows.length]);
  const nudge = (dir: -1 | 1) => scroller.current?.scrollBy({ left: dir * (w + gap) * 3, behavior: "smooth" });
  const arrow = (dir: -1 | 1, on: boolean) => (
    <button type="button" aria-label={dir < 0 ? "Scroll left" : "Scroll right"} onClick={() => nudge(dir)} disabled={!on} style={{ width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: 0, padding: 0, cursor: on ? "pointer" : "default", color: E.color.ink, opacity: on ? 1 : 0.25 }}>
      {dir < 0 ? <ChevronLeft size={18} strokeWidth={1.4} /> : <ChevronRight size={18} strokeWidth={1.4} />}
    </button>
  );
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ ...E.type.label10, letterSpacing: "0.06em", color: E.color.inkMuted }}>{title}</div>
        {/* Arrows on desktop (Alborz's notes, 2026-10-12) — the row still scrolls. */}
        {desktop && (canLeft || canRight) && <div style={{ display: "inline-flex", gap: 2 }}>{arrow(-1, canLeft)}{arrow(1, canRight)}</div>}
      </div>
      <div ref={scroller} onScroll={measure} className="e-strip" style={{ display: "flex", gap, marginTop: 12, overflowX: "auto", scrollSnapType: "x mandatory", scrollbarWidth: "none", paddingBottom: 4, ...(desktop ? {} : { marginRight: -bleed, paddingRight: bleed }) }}>
        {shows.map((s) => (
          // A column from the top (Alborz, round 6): a button centres its content, so a
          // two-line name was lifting its poster above the others; the posters now sit on
          // one line and the words hang below as long as they need.
          <button key={s.tvmazeId} type="button" onClick={() => onPick(s)} title={s.name} aria-label={`${s.name} — ${action.toLowerCase()}`} style={{ width: w, flexShrink: 0, background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left", scrollSnapAlign: "start", color: E.color.ink, WebkitTapHighlightColor: "transparent", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "flex-start", alignSelf: "flex-start" }}>
            <span style={{ display: "block", width: w, height: h, background: E.color.draft, overflow: "hidden" }}>
              {s.imageUrl && <img src={s.imageUrl} alt="" loading="lazy" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
            </span>
            <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontFamily: E.font.interface, fontWeight: 600, fontSize: size === "tile" ? 13 : 12, marginTop: size === "tile" ? 10 : 8, lineHeight: size === "tile" ? 1.3 : 1.2 }}>{s.name}</span>
            <span style={{ display: "block", ...(size === "tile" ? E.type.label10 : { ...E.type.label9, letterSpacing: "0.08em" }), color: E.color.inkMuted, marginTop: 3 }}>{action} →</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The poster strips: thumbnails with the name and "Pick →" / "Pitch →", bleeding off the phone's right edge.
 *  `size` "thumb" = 72×104 (the onboarding and the invite wall); "tile" = the shelves' 104×148 (the browse bands). */
export function EditorialStrips({ excludeTvmazeIds, onPick, action = "Pick", desktop = false, size = "thumb", bleed = E.space.gutter, style }: { excludeTvmazeIds: Set<number>; onPick: (s: BrowseShow) => void; action?: string; desktop?: boolean; size?: "thumb" | "tile"; bleed?: number; style?: React.CSSProperties }) {
  const rows = useBrowseRows(excludeTvmazeIds);
  if (rows.length === 0) return null;
  return (
    <div style={style}>
      {rows.map((r) => <StripRow key={r.key} title={stripTitle(r.key, r.title)} shows={r.shows} onPick={onPick} action={action} desktop={desktop} size={size} bleed={bleed} />)}
    </div>
  );
}

/** "Or browse" on a rule with Spoiler-safe at the right. */
export function BrowseHead({ children = "Or browse", style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <SectionHead right={<span style={{ color: E.color.inkMuted }}>Spoiler-safe</span>} style={style}>{children}</SectionHead>;
}

/** Each friend on a hairline row with Copy link (the just-sent invites' own links). */
export function LinkRows({ links, topRule = "ink", nameStyle = "text", style }: { links: { name: string; link: string }[]; topRule?: "ink" | "hairline"; nameStyle?: "text" | "mono"; style?: React.CSSProperties }) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(link: string) {
    try { navigator.clipboard?.writeText(link); } catch { /* ignore */ }
    setCopied(link);
    window.setTimeout(() => setCopied((c) => (c === link ? null : c)), 1500);
  }
  return (
    <div style={style}>
      {links.map((l, i) => (
        <div key={l.link} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 0", borderTop: i === 0 ? `1px solid ${topRule === "ink" ? E.color.ink : E.color.hairline}` : undefined, borderBottom: `1px solid ${E.color.hairline}` }}>
          <span style={nameStyle === "mono" ? { ...E.type.label11, color: E.color.ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : { fontFamily: E.font.interface, fontWeight: 600, fontSize: 15, color: E.color.ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
          <UnderlineWord onClick={() => copy(l.link)} label={copied === l.link ? "copied" : `copy ${l.name}'s invite link`} style={{ flexShrink: 0 }}>{copied === l.link ? "Copied" : "Copy link"}</UnderlineWord>
        </div>
      ))}
    </div>
  );
}

/** The welcome words above the deck's first card, in ink on the accent ground. */
export function WelcomeHead({ desktop = false, style }: { desktop?: boolean; style?: React.CSSProperties }) {
  return (
    <div style={{ color: E.color.ink, ...style }}>
      <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: 34, lineHeight: 1.05, letterSpacing: "-0.01em" }}>Welcome to Sidebar</div>
      <div style={{ ...E.type.body15, marginTop: 10 }}>A place for you and your friends to talk about TV, spoiler-free.</div>
      <div style={{ ...E.type.note13, lineHeight: 1.5, marginTop: 12, opacity: 0.85 }}>Before you get set up, a few questions to get you in the mood for TV. Your friends will answer these too.</div>
    </div>
  );
}

/** The deck's card: cream, no frame, lifted by the flat friend stack, its words centred. */
export function questionCardStyle(mobile: boolean, extra?: React.CSSProperties): React.CSSProperties {
  return { position: "relative", background: E.color.cream, color: E.color.ink, boxShadow: E.shadow.cardStack, borderRadius: 0, margin: "0 6px 0 0", height: mobile ? 430 : 340, boxSizing: "border-box", padding: mobile ? "22px 24px" : "28px 40px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", flexShrink: 0, ...extra };
}
/** NOPE / YES / GET STARTED!: a tab breaking the card's edge by 14px. */
export function cardTabStyle(color: string, mobile: boolean, place: React.CSSProperties): React.CSSProperties {
  return { position: "absolute", height: mobile ? 40 : 50, padding: mobile ? "0 16px" : "0 20px", background: color, color: E.color.cream, fontFamily: E.font.interface, fontWeight: 700, fontSize: 14, letterSpacing: "0.04em", display: "inline-flex", alignItems: "center", gap: 8, border: 0, cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent", ...place };
}
