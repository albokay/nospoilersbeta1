import React, { useState } from "react";
import Modal from "./Modal";
import StarFace from "./v2/StarFace";
import { CANON } from "../styles/canon";
import { M, OVERLAY, LORA } from "../mobile/m";
import { useEditorial } from "../lib/skin";
import { E } from "../styles/editorial";
import { EditorialDialog } from "./editorial/GroupRoom";
import { BottomSheet } from "./editorial/Overlays";
import { UnderlineWord } from "./editorial/Chrome";
import { inARow } from "../lib/letterRange";

// Rating capture modal — replaces the OneSelectProgress confirm modal on
// forward progress advancement in V2/V3 surfaces only. Spec:
// /Users/alborzkamalizad/Downloads/sidebar_spec_rating_capture.md
//
// Six rating pills stacked vertically + Cancel / Skip rating at the bottom.
// Tapping a pill IS the commit: the other five pills lose their text labels
// (pills stay visible, empty), 150ms later the parent's onCommit fires with
// the chosen rating. "skip rating" confirms the progress advance WITHOUT a
// rating (onSkip). No "Next" button. Backdrop does nothing (no-op onClose
// passed to Modal so the dimmed-overlay click is dead).
//
// The modal does NOT write to the DB itself. Caller is responsible for:
//   - upsertEpisodeRating on onCommit (advance progress + save rating)
//   - advancing watch progress on onSkip (no rating)
//   - closing this modal (by unmounting it)

// Integer scale ASCENDS with goodness: 1 = worst, 6 = best. Aligns with
// the star-face display on the friend room map (more stars = better).
export const RATING_LABELS: Record<number, string> = {
  1: "Nope",
  2: "Losing me",
  3: "I'll keep going",
  4: "Solid",
  5: "Things are cooking",
  6: "Woah!",
};

// ── Canon palette ────────────────────────────────────────────────────────
const MIDNIGHT = CANON.dark; // midnightblue
const CREAM    = CANON.cream;
const SKY      = CANON.friend;
const INTER    = "Inter, sans-serif";

const COMMIT_DELAY_MS = 150;

// Star face in a sky CIRCLE — the same shared StarFace (cream stars) the
// room map's rating cells use (dice dots → stars, 2026-07-07), so the
// pick-a-rating choices and the map read as one system.
function RatingStars({ rating, size = 24 }: { rating: number; size?: number }) {
  return (
    <div style={{ width: size, height: size, background: SKY, borderRadius: "50%", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <StarFace rating={rating} size={size} />
    </div>
  );
}

export default function RatingCaptureModal({
  season,
  episode,
  onCommit,
  onCancel,
  onSkip,
  mobile = false,
  showName,
  stretch,
  onCommitMany,
  stretchNote,
}: {
  season: number;
  episode: number;
  onCommit: (rating: number) => void;
  onCancel: () => void;
  /** Confirm the progress advance but skip rating this episode for now. */
  onSkip?: () => void;
  /** /m idiom (polish pass 2026-09-14): a yellow bottom sheet — it's a
   *  decision about a show. Desktop Modal path untouched. */
  mobile?: boolean;
  /** Caption context for the mobile sheet ("{show} · season {s}"). */
  showName?: string;
  /** Letters after a binge, CP3 (2026-10-25): after a jump of two to six
   *  episodes, every episode of the stretch gets a row of the guide's seven
   *  circles (the order watched, the landing episode last); nothing is
   *  required — Skip covers them all, Done saves whatever was tapped
   *  through `onCommitMany`. Editorial only; the classic look keeps the
   *  single-episode step. */
  stretch?: { episodes: { s: number; e: number }[] };
  onCommitMany?: (ratings: { s: number; e: number; rating: number }[]) => void;
  /** Past six episodes: the single step for the landing episode plus this
   *  line ("You watched fourteen in a row. Rate the others from the show
   *  guide whenever you like."). */
  stretchNote?: string;
}) {
  // null until the user taps a rating. Once set, the other pills go
  // label-empty and all controls are disabled to prevent a second tap
  // during the 150ms commit window.
  const [selected, setSelected] = useState<number | null>(null);
  // The stretch's taps, by "s-e" (0 = the empty ring, no rating).
  const [picks, setPicks] = useState<Record<string, number>>({});
  const editorial = useEditorial();

  function pick(rating: number) {
    if (selected !== null) return;
    setSelected(rating);
    window.setTimeout(() => onCommit(rating), COMMIT_DELAY_MS);
  }

  const locked = selected !== null;

  // The editorial capture (Alborz's notes, item 7): "How was episode N?" in
  // Lora, the show and season in mono, the six ratings as hairline rows
  // (the star face in its sky disc, the words), a tap commits; Cancel as a
  // frame and Skip underlined in alert. The dialog on desktop, the sheet on
  // the phone. Same commit, same skip.
  if (editorial && stretch && onCommitMany && stretch.episodes.length >= 2) {
    const eps = stretch.episodes;
    const first = eps[0], last = eps[eps.length - 1];
    const sameSeason = eps.every((x) => x.s === first.s);
    const heading = sameSeason ? `How were episodes ${first.e} to ${last.e}?` : `How were S${first.s} E${first.e} to S${last.s} E${last.e}?`;
    const sub = `${showName ? `${showName} · ` : ""}${sameSeason ? `season ${first.s} · ` : ""}${inARow(eps.length)}`;
    const keyOf = (x: { s: number; e: number }) => `${x.s}-${x.e}`;
    // The guide's picker circle (ShowReference): a 2px identity ring, filled when chosen.
    const circle = (on: boolean): React.CSSProperties => ({
      width: 36, height: 36, borderRadius: "50%", border: `2px solid ${E.color.identity}`, background: on ? E.color.identity : "transparent",
      padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxSizing: "border-box",
    });
    const done = () => onCommitMany(eps.filter((x) => (picks[keyOf(x)] ?? 0) > 0).map((x) => ({ s: x.s, e: x.e, rating: picks[keyOf(x)] })));
    const body = (
      <>
        <div style={E.type.letterTitle22}>{heading}</div>
        <div style={{ ...E.type.label11, color: E.color.inkSub, marginTop: 6 }}>{sub}</div>
        <div style={{ marginTop: 8 }}>
          {eps.map((x, i) => {
            const r = picks[keyOf(x)] ?? 0;
            return (
              <div key={keyOf(x)} style={{ padding: "12px 0 14px", borderBottom: i < eps.length - 1 ? `1px solid ${E.color.hairline}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <span style={E.type.label11}>{sameSeason ? `E${x.e}` : `S${x.s} E${x.e}`}</span>
                  <span style={{ ...E.type.label10, color: E.color.ink, whiteSpace: "nowrap", minHeight: 12 }}>{r ? RATING_LABELS[r] : ""}</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => {
                    const on = r === n;
                    return (
                      <button key={n} type="button" aria-pressed={on} aria-label={n ? RATING_LABELS[n] : "No rating"} title={n ? RATING_LABELS[n] : "No rating"} onClick={() => setPicks((p) => ({ ...p, [keyOf(x)]: n }))} style={circle(on)}>
                        {n > 0 && <StarFace rating={n} size={28} color={on ? E.color.cream : E.color.identity} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 18 }}>
          {onSkip ? <UnderlineWord onClick={onSkip} style={{ color: E.color.alert }}>Skip the ratings</UnderlineWord> : <span />}
          <button type="button" onClick={done} style={{ ...E.type.button16, height: 48, padding: "0 22px", border: 0, background: E.color.ink, color: E.color.cream, cursor: "pointer", boxSizing: "border-box" }}>Done →</button>
        </div>
      </>
    );
    return mobile
      ? <BottomSheet onClose={onCancel} zIndex={1200} label="Rate the episodes">{body}</BottomSheet>
      : <EditorialDialog onClose={onCancel} width={480} label="Rate the episodes" align="left">{body}</EditorialDialog>;
  }

  if (editorial) {
    const body = (
      <>
        <div style={E.type.letterTitle22}>How was episode {episode}?</div>
        <div style={{ ...E.type.label11, color: E.color.inkSub, marginTop: 6 }}>{showName ? `${showName} · ` : ""}season {season}</div>
        <div style={{ marginTop: 18 }}>
          {[6, 5, 4, 3, 2, 1].map((r) => {
            const showLabel = !locked || selected === r;
            return (
              <button key={r} type="button" onClick={() => pick(r)} disabled={locked} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", minHeight: 52, padding: "8px 0", background: "transparent", border: 0, borderBottom: `1px solid ${E.color.hairline}`, cursor: locked ? "default" : "pointer", color: E.color.ink, textAlign: "left", opacity: showLabel ? 1 : 0.35, WebkitTapHighlightColor: "transparent" }}>
                <RatingStars rating={r} size={28} />
                <span style={{ fontFamily: E.font.interface, fontWeight: 600, fontSize: 15, visibility: showLabel ? "visible" : "hidden" }}>{RATING_LABELS[r]}</span>
              </button>
            );
          })}
        </div>
        {stretchNote && <div style={{ ...E.type.note13, color: E.color.inkMuted, marginTop: 16 }}>{stretchNote}</div>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 22 }}>
          {onSkip ? <UnderlineWord onClick={onSkip} style={{ color: E.color.alert }}>Skip the rating</UnderlineWord> : <span />}
          <button type="button" onClick={onCancel} disabled={locked} style={{ ...E.type.button16, height: 48, padding: "0 22px", border: `1px solid ${E.color.ink}`, background: "transparent", color: E.color.ink, cursor: "pointer", boxSizing: "border-box" }}>Cancel</button>
        </div>
      </>
    );
    return mobile
      ? <BottomSheet onClose={locked ? () => {} : onCancel} zIndex={1200} label="Rate the episode">{body}</BottomSheet>
      : <EditorialDialog onClose={locked ? () => {} : onCancel} width={420} label="Rate the episode" align="left">{body}</EditorialDialog>;
  }

  if (mobile) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(26,58,74,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "mDimIn 180ms ease-out" }}>
        <div style={{ ...OVERLAY.sheet, background: CANON.accent }}>
          <div style={OVERLAY.grabber(CREAM)} />
          <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, lineHeight: 1.25, color: CREAM }}>
            How was episode {episode}?
          </div>
          <div style={{ fontFamily: INTER, fontWeight: 400, fontSize: 13, lineHeight: 1.45, color: CREAM, opacity: 0.85, margin: "2px 0 16px" }}>
            {showName ? `${showName} · ` : ""}season {season}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[6, 5, 4, 3, 2, 1].map((r) => {
              const showLabel = !locked || selected === r;
              return (
                <button key={r} onClick={() => pick(r)} disabled={locked} style={mPill}>
                  <span style={{ visibility: showLabel ? "visible" : "hidden", display: "inline-flex", alignItems: "center", gap: 12 }}>
                    <RatingStars rating={r} size={28} />
                    {RATING_LABELS[r]}
                  </span>
                </button>
              );
            })}
            <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 12, marginTop: 12 }}>
              <button onClick={onCancel} disabled={locked} style={{ ...M.pill.M, background: "transparent", color: CREAM, border: `2px solid ${CREAM}` }}>Cancel</button>
              {onSkip && (
                <button onClick={onSkip} disabled={locked} style={{ ...M.pill.M, background: "transparent", color: CANON.alert, border: `2px solid ${CANON.alert}` }}>Skip</button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    // Yellow dialog (polish pass 2026-09-15): Subtitle title + show caption,
    // 48px option pills, M Cancel/Skip. Tap-out now cancels (it aborts the
    // progress advance, same as the Cancel button — recoverable).
    <Modal
      onClose={locked ? () => {} : onCancel}
      width="min(360px, 92vw)"
      cardStyle={{ borderRadius: 24, padding: 24, background: CANON.accent, animation: "dCardRise 180ms ease-out" }}
    >
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, lineHeight: 1.3, color: CREAM, margin: 0 }}>
          How was episode {episode}?
        </h3>
        <div style={{ fontFamily: INTER, fontWeight: 400, fontSize: 13, lineHeight: 1.45, color: CREAM, opacity: 0.85, marginTop: 2 }}>
          {showName ? `${showName} · ` : ""}season {season}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Render top-to-bottom: best (6 = Woah!) → worst (1 = Nope.). */}
        {[6, 5, 4, 3, 2, 1].map((r) => {
          const showLabel = !locked || selected === r;
          return (
            <button key={r} onClick={() => pick(r)} disabled={locked} style={pillStyle}>
              {/* Keep label slot rendered (visibility:hidden) so the pill
                  height doesn't change when labels collapse. */}
              <span style={{ visibility: showLabel ? "visible" : "hidden", display: "inline-flex", alignItems: "center", gap: 12 }}>
                <RatingStars rating={r} size={28} />
                {RATING_LABELS[r]}
              </span>
            </button>
          );
        })}

        <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 12, marginTop: 12 }}>
          <button onClick={onCancel} disabled={locked} style={outlineStyle}>Cancel</button>
          {onSkip && (
            /* Alert outline + text (Alborz 2026-08-11) — skipping is the
               "no rating" path, visually apart from the cream cancel. */
            <button onClick={onSkip} disabled={locked} style={skipStyle}>Skip</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// /m sheet option pill (polish pass 2026-09-14): 48px, Inter 15/600 dark.
const mPill: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  minHeight: 48,
  padding: "10px 16px",
  borderRadius: 9999,
  background: CREAM,
  color: MIDNIGHT,
  border: "none",
  fontFamily: INTER,
  fontSize: 15,
  fontWeight: 600,
  textAlign: "left",
  cursor: "pointer",
  lineHeight: 1.3,
  boxSizing: "border-box",
};

const pillStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  minHeight: 48,
  padding: "10px 16px",
  borderRadius: 9999,
  background: CREAM,
  color: MIDNIGHT,
  border: "none",
  fontFamily: INTER,
  fontSize: 15,
  fontWeight: 600,
  textAlign: "left",
  cursor: "pointer",
  lineHeight: 1.3,
  boxSizing: "border-box",
};

const outlineStyle: React.CSSProperties = {
  padding: "12px 28px",
  minHeight: 44,
  borderRadius: 9999,
  background: "transparent",
  color: CREAM,
  border: `2px solid ${CREAM}`,
  fontFamily: INTER,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  boxSizing: "border-box",
};

const skipStyle: React.CSSProperties = {
  ...outlineStyle,
  color: CANON.alert,
  border: `2px solid ${CANON.alert}`,
};
