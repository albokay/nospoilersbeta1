/**
 * Compose.tsx — the pieces of writing a letter under the editorial skin
 * (checkpoint 6, 2026-10-12; the E3Compose / D3Compose boards and the
 * bible's ComposeShell). `ComposeForm` keeps every piece of its state and
 * every call; under `editorial` it draws this layout instead of the card:
 * the folded corner as the way out, the `friend` band with the room and the
 * episode, the minimize ring, the show's name and the writer's stamp in
 * cream, then the title on a hairline, the ruled paper on cream, the prompt
 * button in `personal`, and the foot.
 */
import React from "react";
import { Sparkles } from "lucide-react";
import { E } from "../../styles/editorial";
import { EditorialDialog, EditorialSheet } from "./GroupRoom";

export const PAPER_LH = E.space.paperRule; // 28 — the line-height AND the rule period, or text drifts off the rules

/** The ruled paper's background: a 1px line at the foot of every 28px line. */
export const PAPER_RULES = `repeating-linear-gradient(to bottom, transparent 0px, transparent ${PAPER_LH - 2}px, ${E.color.inkLines} ${PAPER_LH - 2}px, ${E.color.inkLines} ${PAPER_LH - 1}px, transparent ${PAPER_LH - 1}px, transparent ${PAPER_LH}px)`;

/** The !important claw-back from theme.ts's global textarea/input paint
 *  (white fill, black text) — scoped to the editorial compose's own classes. */
export const COMPOSE_CSS = `
  .e-compose-title { background-color: transparent !important; background-image: none !important; color: ${E.color.ink} !important; }
  .e-compose-title::placeholder { color: rgba(26,58,74,0.45) !important; opacity: 1 !important; font-family: ${E.font.display}; font-weight: 700; }
  .e-compose-paper { background-color: transparent !important; background-image: ${PAPER_RULES} !important; background-position: 0 0 !important; background-size: 100% ${PAPER_LH}px !important; background-repeat: repeat !important; background-attachment: local !important; color: ${E.color.ink} !important; }
  .e-compose-paper::placeholder { color: rgba(26,58,74,0.45) !important; opacity: 1 !important; font-family: ${E.font.display}; font-style: normal; }
`;

/** The minimize: a 40px empty circle with a cream ring and a cream dash. The draft stays. */
export function MinimizeRing({ onClick, style }: { onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button type="button" aria-label="Minimize — your draft stays" title="Minimize — check the room or the guide; your draft stays" onClick={onClick}
      style={{ width: 40, height: 40, borderRadius: "50%", border: `1px solid ${E.color.cream}`, boxSizing: "border-box", background: "transparent", padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent", ...style }}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={E.color.cream} strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
    </button>
  );
}

/** "Want a prompt?" — cream with a dotted `personal` frame and `personal`
 *  words (Alborz's notes, round 5: the filled block competed with the
 *  foot's two acts). The same look on every letter, so a host's
 *  `background` no longer applies. */
export function PromptButton({ onClick, label = "Want a prompt?" }: { onClick: () => void; label?: React.ReactNode; background?: string }) {
  return (
    <button type="button" onClick={onClick} style={{ ...E.type.label11, height: 40, padding: "0 14px", boxSizing: "border-box", background: E.color.cream, color: E.color.personal, border: `1px dotted ${E.color.personal}`, display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <Sparkles size={13} color={E.color.personal} aria-hidden="true" />{label}
    </button>
  );
}

export const TITLE_INPUT = (desktop: boolean): React.CSSProperties => ({
  width: "100%", boxSizing: "border-box", border: 0, borderBottom: `1px solid ${E.color.ink}`, outline: "none", background: "transparent",
  fontFamily: E.font.display, fontWeight: 700, fontSize: desktop ? 24 : 22, lineHeight: 1.2, color: E.color.ink, padding: "0 0 8px", margin: 0, borderRadius: 0,
});
export const PAPER_TEXTAREA = (desktop: boolean, minLines: number): React.CSSProperties => ({
  width: "100%", minWidth: "100%", maxWidth: "100%", boxSizing: "border-box", border: 0, outline: "none", resize: "none", overflow: "hidden", display: "block",
  fontFamily: E.font.display, fontWeight: 400, fontSize: desktop ? 17 : 16, lineHeight: `${PAPER_LH}px`, color: E.color.ink,
  padding: 0, margin: 0, borderRadius: 0, height: `${minLines * PAPER_LH}px`, minHeight: `${minLines * PAPER_LH}px`,
});

/** The foot: "not now" in `alert` underline, "Send letter →" as a 48px ink block. */
export function ComposeFoot({ onNotNow, onSend, canSubmit, submitting, sendLabel, hideCancel = false, style }: {
  onNotNow: () => void; onSend: () => void; canSubmit: boolean; submitting: boolean; sendLabel: React.ReactNode; hideCancel?: boolean; style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", justifyContent: hideCancel ? "flex-end" : "space-between", alignItems: "center", gap: 16, ...style }}>
      {!hideCancel && (
        <button type="button" onClick={onNotNow} disabled={submitting} style={{ ...E.type.label11, color: E.color.alert, textDecoration: "underline", textUnderlineOffset: 3, background: "transparent", border: 0, padding: "12px 0", cursor: submitting ? "not-allowed" : "pointer" }}>not now</button>
      )}
      <button type="button" onClick={onSend} disabled={!canSubmit} style={{ ...E.type.label11, height: 48, padding: "0 20px", background: E.color.ink, color: E.color.cream, border: 0, display: "inline-flex", alignItems: "center", gap: 8, cursor: canSubmit ? "pointer" : "not-allowed", opacity: canSubmit || submitting ? 1 : 0.6 }}>
        {sendLabel}
      </button>
    </div>
  );
}

/** "Are you sure?" — the discard confirm as the bible's dialog (desktop) or sheet (phone). */
export function DiscardConfirm({ desktop, onKeep, onDiscard }: { desktop: boolean; onKeep: () => void; onDiscard: () => void }) {
  const body = (
    <>
      <div style={{ ...E.type.letterTitle22, paddingRight: desktop ? 28 : 0 }}>Are you sure?</div>
      <div style={{ ...E.type.note13, color: E.color.inkSub, marginTop: 8 }}>You will lose what you've written.</div>
      <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
        <button type="button" onClick={onKeep} style={{ ...E.type.button16, flex: 1, height: 54, border: `1px solid ${E.color.ink}`, background: "transparent", color: E.color.ink, cursor: "pointer", boxSizing: "border-box" }}>Keep writing</button>
        <button type="button" onClick={onDiscard} style={{ ...E.type.button16, flex: 1, height: 54, border: 0, background: E.color.alert, color: E.color.cream, cursor: "pointer" }}>Discard</button>
      </div>
    </>
  );
  return desktop
    ? <EditorialDialog onClose={onKeep} width={420} label="Are you sure?" align="left">{body}</EditorialDialog>
    : <EditorialSheet onClose={onKeep}>{body}</EditorialSheet>;
}
