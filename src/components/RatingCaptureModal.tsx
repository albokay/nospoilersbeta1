import React, { useState } from "react";
import Modal from "./Modal";
import StarFace from "./v2/StarFace";
import { CANON } from "../styles/canon";

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
}: {
  season: number;
  episode: number;
  onCommit: (rating: number) => void;
  onCancel: () => void;
  /** Confirm the progress advance but skip rating this episode for now. */
  onSkip?: () => void;
}) {
  // null until the user taps a rating. Once set, the other pills go
  // label-empty and all controls are disabled to prevent a second tap
  // during the 150ms commit window.
  const [selected, setSelected] = useState<number | null>(null);

  function pick(rating: number) {
    if (selected !== null) return;
    setSelected(rating);
    window.setTimeout(() => onCommit(rating), COMMIT_DELAY_MS);
  }

  const locked = selected !== null;

  return (
    // Backdrop dismiss disabled per spec. onClose is a no-op; cancel goes
    // through the explicit cancel button below.
    <Modal onClose={() => {}} width="min(420px, 92vw)">
      <div style={{ marginBottom: 16 }}>
        {/* Header 2 — Inter bold 14 (restructure spec §16; −2 letter-spacing dropped). */}
        <h3 style={{ fontFamily: INTER, fontWeight: 700, fontSize: 14, color: MIDNIGHT, margin: 0 }}>
          How was episode {episode} (season {season})?
        </h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Render top-to-bottom: best (6 = Woah!) → worst (1 = Nope.). */}
        {[6, 5, 4, 3, 2, 1].map((r) => {
          const showLabel = !locked || selected === r;
          return (
            <button key={r} onClick={() => pick(r)} disabled={locked} style={pillStyle}>
              {/* Keep label slot rendered (visibility:hidden) so the pill
                  height doesn't change when labels collapse. */}
              <span style={{ visibility: showLabel ? "visible" : "hidden", display: "inline-flex", alignItems: "center", gap: 12 }}>
                <RatingStars rating={r} />
                {RATING_LABELS[r]}
              </span>
            </button>
          );
        })}

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 12 }}>
          <button onClick={onCancel} disabled={locked} style={outlineStyle}>cancel</button>
          {onSkip && (
            <button onClick={onSkip} disabled={locked} style={outlineStyle}>skip rating</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

const pillStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "11px 18px",
  borderRadius: 65,
  background: CREAM,
  color: MIDNIGHT,
  border: "none",
  fontFamily: INTER,
  fontSize: 13, // Body — Inter regular 13 (spec §16; −2 letter-spacing dropped)
  fontWeight: 400,
  textAlign: "left",
  cursor: "pointer",
  lineHeight: 1.3,
};

const outlineStyle: React.CSSProperties = {
  padding: "9px 22px",
  borderRadius: 65,
  background: "transparent",
  color: CREAM,
  border: `2px solid ${CREAM}`,
  fontFamily: INTER,
  fontSize: 13, // Body — Inter regular 13 (spec §16; −2 letter-spacing dropped)
  fontWeight: 400,
  cursor: "pointer",
};
