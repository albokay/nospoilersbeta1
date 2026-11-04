/**
 * StandAlone.tsx — the "Stand alone mode" switch beside the picker's season
 * menu (his design, 2026-11-04, canvas Y3k7yZ5gvQqW5qC6fTeGdX): the label in
 * italic mono caps, the homepage's two-part ON/OFF switch, then a green "?"
 * on an ink disc. The "?" opens the explainer — a paper-note popover on
 * desktop, a bottom sheet on the phone. Shown only on a show the mode
 * applies to (lib/standAlone's `standAloneSwitchVisible`), and only with a
 * signed-in viewer, since the flip is the show's and lands in the catalog.
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { E } from "../../styles/editorial";
import useSheetSwipeDown from "../../lib/useSheetSwipeDown";
import { setShowStandAlone } from "../../lib/db";
import { STAND_ALONE_HELP, useStandAlone, type StandAloneShow } from "../../lib/standAlone";

/** The phone, by the same break the picker's label uses. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

const LABEL: React.CSSProperties = { ...E.type.label9, fontStyle: "italic", letterSpacing: "0.04em", color: E.color.ink, whiteSpace: "nowrap" };

export function StandAloneSwitch({ show }: { show: StandAloneShow }) {
  const on = useStandAlone(show);
  const phone = useIsPhone();
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const flip = async (next: boolean) => {
    if (next === on || busy || !show.id) return;
    setBusy(true);
    try { await setShowStandAlone(show.id, next); }
    catch (e) { console.warn("stand alone switch failed", e); }
    finally { setBusy(false); }
  };
  const half = (value: boolean, word: string) => (
    <button
      type="button" aria-pressed={on === value} onClick={() => { void flip(value); }} disabled={busy}
      style={{ ...E.type.label9, letterSpacing: "0.06em", padding: "5px 6px", background: on === value ? E.color.ink : "transparent", color: on === value ? E.color.cream : E.color.ink, border: 0, cursor: "pointer", lineHeight: 1, WebkitTapHighlightColor: "transparent" }}
    >
      {word}
    </button>
  );
  return (
    <span ref={anchorRef} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      <span style={LABEL}>Stand alone mode</span>
      <span role="group" aria-label="Stand alone mode" style={{ display: "inline-flex", border: `1px solid ${E.color.ink}` }}>
        {half(true, "On")}
        {half(false, "Off")}
      </span>
      <button
        type="button" aria-label="What is stand alone mode?" title="What is stand alone mode?" onClick={() => setHelp((h) => !h)}
        style={{ width: 16, height: 16, borderRadius: "50%", background: E.color.ink, color: E.color.personal, border: 0, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: E.font.label, fontSize: 11, lineHeight: 1, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
      >
        ?
      </button>
      {help && (phone ? <HelpSheet onClose={() => setHelp(false)} /> : <HelpNote anchor={anchorRef} onClose={() => setHelp(false)} />)}
    </span>
  );
}

/** Desktop: the explainer as a paper note hung under the switch — cream,
 *  hairline-framed, the accent bar down its left edge, no shadow; a click
 *  anywhere else or Escape closes it. */
function HelpNote({ anchor, onClose }: { anchor: React.RefObject<HTMLSpanElement>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [anchor, onClose]);
  return (
    <div ref={ref} role="note" style={{ position: "absolute", right: 0, top: "calc(100% + 10px)", width: 300, zIndex: 20, background: E.color.cream, color: E.color.ink, border: `1px solid ${E.color.ink}`, borderLeft: `5px solid ${E.color.accent}`, padding: "12px 14px 13px 13px", boxSizing: "border-box", textAlign: "left", textTransform: "none", letterSpacing: 0, fontStyle: "normal" }}>
      <div style={{ ...E.type.label9, color: E.color.inkMuted }}>Stand alone mode</div>
      <div style={{ ...E.type.note13, marginTop: 6 }}>{STAND_ALONE_HELP}</div>
    </div>
  );
}

/** The phone: the explainer as a bottom sheet (the season map's model);
 *  swipe down or tap the veil to close. Built here rather than from
 *  Overlays' BottomSheet so the picker's file doesn't import its importer. */
function HelpSheet({ onClose }: { onClose: () => void }) {
  const swipe = useSheetSwipeDown(onClose, { open: true });
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 1200, textTransform: "none", letterSpacing: 0, fontStyle: "normal" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: E.color.veil, animation: "mDimIn 180ms ease-out" }} />
      <div role="dialog" aria-label="Stand alone mode" {...swipe.handlers} style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: E.color.cream, color: E.color.ink, padding: `10px ${E.space.gutter}px calc(env(safe-area-inset-bottom, 0px) + 28px)`, boxSizing: "border-box", animation: "mSheetRise 180ms ease-out", fontFamily: E.font.interface, ...swipe.style }}>
        <div aria-hidden="true" style={{ width: 36, height: 4, background: E.color.ink, margin: "0 auto" }} />
        <div style={{ ...E.type.letterTitle22, marginTop: 22 }}>Stand alone mode</div>
        <div style={{ ...E.type.body15, marginTop: 14 }}>{STAND_ALONE_HELP}</div>
      </div>
    </div>,
    document.body,
  );
}
