/**
 * Overlays.tsx — the editorial overlays for everything that was still
 * classic after checkpoint 8 (Alborz's notes, item 7, 2026-10-12):
 *   Drawer        the desktop drawer from the window's right edge
 *   BottomSheet   the phone's bottom sheet, on the season map's model
 *   Confirm       a title, a line, the act as a block and Cancel as a frame
 *   FinishedTiles the finished-together drawer's body (both platforms)
 *   ChatMessages / ChatComposer   the chat, both platforms
 * The hosts keep their state and calls; these only draw.
 */
import React, { useRef } from "react";
import { ArrowUp } from "lucide-react";
import { E } from "../../styles/editorial";
import useSheetSwipeDown from "../../lib/useSheetSwipeDown";
import { linkifyText } from "../../lib/linkify";
import { EditorialDialog } from "./GroupRoom";
import { SectionHead, UnderlineWord } from "./Chrome";
import { FORM_CSS } from "./Onboarding";
import LetterDisc from "../LetterDisc";
import { CelebrationStar } from "../CelebrationBadge";

const G = E.space.gutter;

/** The desktop drawer: a cream panel from the window's right edge with a
 *  1px ink edge; the head carries the title in Lora and a mono caption, the
 *  × at its right; the body scrolls; `foot` pins under it. No dim — the
 *  page stays readable beside it; a click outside closes it. */
export function Drawer({ onClose, title, caption, head, children, foot, width = 440, zIndex = 1300, label, bodyStyle }: {
  onClose: () => void; title?: React.ReactNode; caption?: React.ReactNode; head?: React.ReactNode; children: React.ReactNode; foot?: React.ReactNode; width?: number; zIndex?: number; label?: string; bodyStyle?: React.CSSProperties;
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: zIndex - 1, background: "transparent" }} />
      <div role="dialog" aria-label={label ?? (typeof title === "string" ? title : undefined)} style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: `min(${width}px, 44vw)`, background: E.color.cream, color: E.color.ink, borderLeft: `1px solid ${E.color.ink}`, display: "flex", flexDirection: "column", zIndex, fontFamily: E.font.interface, animation: "eDrawerIn 180ms ease-out", boxSizing: "border-box" }}>
        <div style={{ padding: "26px 28px 16px", borderBottom: `1px solid ${E.color.ink}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {head ?? (
              <>
                <div style={{ ...E.type.letterTitle22, fontSize: 24, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
                {caption && <div style={{ ...E.type.label11, color: E.color.inkSub, marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{caption}</div>}
              </>
            )}
          </div>
          <button type="button" aria-label="Close" title="Close" onClick={onClose} style={{ width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20, lineHeight: 1, background: "transparent", border: 0, padding: 0, cursor: "pointer", color: E.color.ink, flexShrink: 0, margin: "-4px -8px 0 0" }}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 28px 32px", ...bodyStyle }}>{children}</div>
        {foot}
      </div>
      <style>{`@keyframes eDrawerIn { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>
    </>
  );
}

/** The phone's bottom sheet (the season map's model): the veil, the cream
 *  panel rising from the bottom with the ink grabber and a square top, the
 *  title in Lora with a mono caption; swipe down or tap the veil to close. */
export function BottomSheet({ onClose, title, caption, head, children, foot, maxHeight = "80dvh", zIndex = 1200, pad = true, label }: {
  onClose: () => void; title?: React.ReactNode; caption?: React.ReactNode; head?: React.ReactNode; children: React.ReactNode; foot?: React.ReactNode; maxHeight?: string; zIndex?: number; pad?: boolean; label?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const swipe = useSheetSwipeDown(onClose, { open: true, scrollRef });
  return (
    <div style={{ position: "fixed", inset: 0, zIndex, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: E.color.veil, animation: "mDimIn 180ms ease-out" }} />
      <div role="dialog" aria-label={label ?? (typeof title === "string" ? title : undefined)} {...swipe.handlers} style={{ position: "relative", background: E.color.cream, color: E.color.ink, maxHeight, display: "flex", flexDirection: "column", padding: "10px 0 0", boxSizing: "border-box", animation: "mSheetRise 180ms ease-out", fontFamily: E.font.interface, overscrollBehavior: "none", ...swipe.style }}>
        <div aria-hidden="true" style={{ width: 36, height: 4, background: E.color.ink, margin: "0 auto", flexShrink: 0 }} />
        {(head || title || caption) && (
          <div style={{ padding: `16px ${G}px 0`, flexShrink: 0 }}>
            {head ?? (
              <>
                {title && <div style={E.type.letterTitle22}>{title}</div>}
                {caption && <div style={{ ...E.type.label11, color: E.color.inkSub, marginTop: 6 }}>{caption}</div>}
              </>
            )}
          </div>
        )}
        <div ref={scrollRef} style={{ overflowY: "auto", WebkitOverflowScrolling: "touch", minHeight: 0, padding: pad ? `14px ${G}px calc(env(safe-area-inset-bottom, 0px) + 24px)` : `0 0 calc(env(safe-area-inset-bottom, 0px) + ${foot ? 0 : 24}px)` }}>{children}</div>
        {foot}
      </div>
    </div>
  );
}

/** A confirm: the title in Lora, a line, the act as a block (ink, or alert
 *  for a loss) beside Cancel as a frame — the dialog on desktop, the sheet
 *  on the phone. */
export function Confirm({ desktop = false, title, note, confirmLabel, cancelLabel = "Cancel", tone = "ink", onConfirm, onCancel, busy = false }: {
  desktop?: boolean; title: React.ReactNode; note?: React.ReactNode; confirmLabel: React.ReactNode; cancelLabel?: string; tone?: "ink" | "alert"; onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  const body = (
    <>
      <div style={{ ...E.type.letterTitle22, paddingRight: desktop ? 28 : 0 }}>{title}</div>
      {note && <div style={{ ...E.type.body15, lineHeight: 1.55, color: E.color.inkSub, marginTop: 10 }}>{note}</div>}
      <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
        <button type="button" onClick={onConfirm} disabled={busy} style={{ ...E.type.button16, flex: 1, height: 54, border: 0, background: tone === "alert" ? E.color.alert : E.color.ink, color: E.color.cream, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}>{confirmLabel}</button>
        <button type="button" onClick={onCancel} style={{ ...E.type.button16, flex: 1, height: 54, border: `1px solid ${E.color.ink}`, background: "transparent", color: E.color.ink, cursor: "pointer", boxSizing: "border-box" }}>{cancelLabel}</button>
      </div>
    </>
  );
  return desktop
    ? <EditorialDialog onClose={onCancel} width={420} label={typeof title === "string" ? title : undefined} align="left">{body}</EditorialDialog>
    : <BottomSheet onClose={onCancel} zIndex={1300} label={typeof title === "string" ? title : undefined}>{body}</BottomSheet>;
}

export type FinishedItem = { roomId: string; showId: string; name: string };

/** The finished-together drawer's body: the shelves' 104×148 tiles with
 *  the name under; a waiting letter's disc on its corner; a show nobody
 *  finished under "Didn't finish" with "Bring it back". */
export function FinishedTiles({ finished, dnf, poster, dot, onOpen, onRevive, desktop = false }: {
  finished: FinishedItem[]; dnf: FinishedItem[]; poster: (it: FinishedItem) => string | null | undefined; dot: (it: FinishedItem) => "blue" | "red" | undefined;
  onOpen: (it: FinishedItem) => void; onRevive: (it: FinishedItem) => void; desktop?: boolean;
}) {
  const tile = (it: FinishedItem, isDnf: boolean) => {
    const p = poster(it);
    const d = dot(it);
    return (
      <div key={it.roomId} style={{ width: 104, position: "relative" }}>
        {d && <LetterDisc kind={d === "red" ? "sealed" : "open"} style={{ position: "absolute", top: -9, left: 4, zIndex: 2, pointerEvents: "none" }} />}
        <button type="button" onClick={() => onOpen(it)} title={`Open the ${it.name} room`} style={{ display: "block", width: 104, background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left", color: E.color.ink, WebkitTapHighlightColor: "transparent" }}>
          {p
            ? <img src={p} alt="" loading="lazy" draggable={false} style={{ width: 104, height: 148, objectFit: "cover", display: "block", opacity: isDnf ? 0.6 : 1 }} />
            : <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 104, height: 148, boxSizing: "border-box", border: `1px solid ${E.color.hairline}`, background: E.color.draft, padding: 8, fontFamily: E.font.display, fontWeight: 700, fontSize: 13, textAlign: "center" }}>{it.name}</span>}
          <span style={{ display: "block", fontFamily: E.font.interface, fontWeight: 600, fontSize: 13, lineHeight: 1.3, marginTop: 10 }}>{it.name}</span>
          <span style={{ display: "block", ...E.type.label10, color: E.color.inkMuted, marginTop: 3 }}>{isDnf ? "Didn't finish" : "Finished"}</span>
        </button>
        {isDnf && <UnderlineWord onClick={() => onRevive(it)} title="Start watching again?" style={{ ...E.type.label10, marginTop: 6 }}>Bring it back →</UnderlineWord>}
      </div>
    );
  };
  const grid: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: desktop ? "24px 20px" : "22px 16px", marginTop: 18 };
  return (
    <>
      {finished.length > 0 && <div style={grid}>{finished.map((it) => tile(it, false))}</div>}
      {dnf.length > 0 && (
        <>
          <SectionHead style={{ marginTop: finished.length ? 32 : 0 }} right={<span style={{ color: E.color.inkMuted }}>{dnf.length}</span>}>Didn&rsquo;t finish</SectionHead>
          <div style={grid}>{dnf.map((it) => tile(it, true))}</div>
        </>
      )}
      {finished.length === 0 && dnf.length === 0 && <div style={{ ...E.type.note13, color: E.color.inkMuted }}>Nothing finished together yet.</div>}
    </>
  );
}

/** The drawer's / sheet's head for the finished drawer: the star and "Finished watching". */
export function FinishedHead({ count }: { count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <CelebrationStar size={20} color={E.color.accent} />
      <span style={{ ...E.type.letterTitle22 }}>Finished watching</span>
      <span style={{ ...E.type.label11, color: E.color.inkMuted }}>{count}</span>
    </div>
  );
}

export type ChatRow = { id: string; mine: boolean; name: string; body: string; pending?: boolean; failed?: boolean; onRetry?: () => void };

/** The messages: a friend's on a sky block with their name in mono above
 *  it; yours on a cream block with an ink frame, at the right. Pending
 *  ones dim with "sending…"; a failed one offers "not sent · retry". */
export function ChatMessages({ rows, empty, bodyRef, style }: { rows: ChatRow[]; empty?: React.ReactNode; bodyRef?: React.RefObject<HTMLDivElement>; style?: React.CSSProperties }) {
  return (
    <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: `18px ${G}px`, display: "flex", flexDirection: "column", ...style }}>
      {rows.length === 0 && empty && <div style={{ marginTop: "auto", textAlign: "center", ...E.type.note13, color: E.color.inkMuted, paddingBottom: 8 }}>{empty}</div>}
      {rows.map((m) => (
        <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.mine ? "flex-end" : "flex-start", marginBottom: 14, opacity: m.pending ? 0.6 : 1 }}>
          {!m.mine && <div style={{ ...E.type.label10, color: E.color.inkMuted, marginBottom: 5 }}>{m.name}</div>}
          <div style={{ maxWidth: "82%", padding: "10px 14px", fontFamily: E.font.interface, fontSize: 15, lineHeight: 1.45, color: E.color.ink, overflowWrap: "anywhere", ...(m.mine ? { background: E.color.cream, border: `1px solid ${E.color.ink}` } : { background: E.color.friend }) }}>{linkifyText(m.body)}</div>
          {m.pending && (m.failed && m.onRetry
            ? <UnderlineWord onClick={m.onRetry} style={{ ...E.type.label10, marginTop: 4 }}>not sent · retry</UnderlineWord>
            : <div style={{ ...E.type.label10, color: E.color.inkMuted, marginTop: 4 }}>sending…</div>)}
        </div>
      ))}
    </div>
  );
}

/** The composer on a cream foot: the field on a rule, the send as an ink square. */
export function ChatComposer({ value, onChange, onSend, placeholder = "Message the group", safeBottom = false }: { value: string; onChange: (v: string) => void; onSend: () => void; placeholder?: string; safeBottom?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-end", padding: `12px ${G}px ${safeBottom ? "calc(env(safe-area-inset-bottom, 0px) + 12px)" : "16px"}`, borderTop: `1px solid ${E.color.hairline}`, background: E.color.cream, flexShrink: 0 }}>
      <style>{FORM_CSS}</style>
      <input
        className="e-field" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSend(); }} placeholder={placeholder} aria-label={placeholder}
        style={{ flex: 1, minWidth: 0, border: 0, borderBottom: `1px solid ${E.color.ink}`, outline: "none", background: "transparent", fontFamily: E.font.interface, fontSize: 16, color: E.color.ink, padding: "10px 0 8px", margin: 0 }}
      />
      <button type="button" onClick={onSend} aria-label="Send" title="Send" style={{ width: 44, height: 44, flexShrink: 0, background: E.color.ink, color: E.color.cream, border: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <ArrowUp size={20} strokeWidth={1.8} />
      </button>
    </div>
  );
}
