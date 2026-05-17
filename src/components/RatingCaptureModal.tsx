import React, { useState } from "react";
import { Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, type LucideIcon } from "lucide-react";
import Modal from "./Modal";

// Rating capture modal — replaces the OneSelectProgress confirm modal on
// forward progress advancement in V2/V3 surfaces only. Spec:
// /Users/alborzkamalizad/Downloads/sidebar_spec_rating_capture.md
//
// Six rating pills stacked vertically + Cancel at the bottom. Tapping a
// pill IS the commit: the other five pills lose their text labels (pills
// stay visible, empty), 150ms later the parent's onCommit fires with the
// chosen rating. No "Next" button. Backdrop does nothing (no-op onClose
// passed to Modal so the dimmed-overlay click is dead).
//
// The modal does NOT write to the DB itself. Caller is responsible for:
//   - upsertEpisodeRating on onCommit
//   - advancing watch progress
//   - closing this modal (by unmounting it)
//   - navigating to /v2/compose

// Integer scale ASCENDS with goodness: 1 = worst, 6 = best. Aligns with
// the dice-face display on the V2 friend room map (more dots = better)
// and with natural sort/query semantics. Inverted from the modal's
// original mapping on 2026-05-16 — pre-existing test-only ratings in
// prod were discarded per user (no migration).
export const RATING_LABELS: Record<number, string> = {
  1: "Nope.",
  2: "Losing me.",
  3: "I'll keep going.",
  4: "Solid.",
  5: "Things are cooking.",
  6: "Woah!",
};

// Lucide dice icons matched to rating value. Same integer→pip-count
// semantics as the map cell's DiceFace (more dots = better).
const DICE_ICONS: Record<number, LucideIcon> = {
  1: Dice1,
  2: Dice2,
  3: Dice3,
  4: Dice4,
  5: Dice5,
  6: Dice6,
};

// Canon friend-space text color (memory: canon_friend_space_text). Used
// for both the dice icon stroke and the pill text so they read as one
// unified unit.
const PILL_INK = "#1a3a4a";

const COMMIT_DELAY_MS = 150;

export default function RatingCaptureModal({
  season,
  episode,
  onCommit,
  onCancel,
}: {
  season: number;
  episode: number;
  onCommit: (rating: number) => void;
  onCancel: () => void;
}) {
  // null until the user taps a rating. Once set, the other pills go
  // label-empty and all controls (pills + cancel) are disabled to
  // prevent a second tap during the 150ms commit window.
  const [selected, setSelected] = useState<number | null>(null);

  function pick(rating: number) {
    if (selected !== null) return;
    setSelected(rating);
    window.setTimeout(() => onCommit(rating), COMMIT_DELAY_MS);
  }

  const locked = selected !== null;

  return (
    // Backdrop dismiss disabled per spec. onClose is a no-op; cancel
    // goes through the explicit Cancel button below.
    <Modal onClose={() => {}} width="min(360px, 92vw)">
      <div style={{ marginBottom: 16 }}>
        <h3 className="title" style={{ fontSize: 17, margin: 0 }}>
          How was episode {episode}, (season {season})?
        </h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Render top-to-bottom: best (6 = Woah!) → worst (1 = Nope.).
            The integer scale ascends with goodness; rendering descending
            here keeps the visual order spec'd in sidebar_spec_rating_capture.md
            (Woah! at top, Nope. at bottom). */}
        {[6, 5, 4, 3, 2, 1].map((r) => {
          const showLabel = !locked || selected === r;
          const DiceIcon = DICE_ICONS[r];
          return (
            <button
              key={r}
              onClick={() => pick(r)}
              disabled={locked}
              style={pillStyle(locked && selected !== r)}
            >
              {/* Keep label slot rendered (visibility:hidden) so the pill
                  height doesn't change when labels collapse. The icon
                  hides with the label so the pill reads as truly empty
                  during the commit window. */}
              <span
                style={{
                  visibility: showLabel ? "visible" : "hidden",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <DiceIcon size={20} color={PILL_INK} strokeWidth={2} />
                {RATING_LABELS[r]}
              </span>
            </button>
          );
        })}

        <button
          onClick={onCancel}
          disabled={locked}
          style={cancelStyle()}
        >
          cancel
        </button>
      </div>
    </Modal>
  );
}

function pillStyle(_emptied: boolean): React.CSSProperties {
  return {
    // flex + alignItems:center vertically centers the icon+label span
    // inside the button. The SVG dice icon's bounding box doesn't align
    // to the text baseline the way an inline glyph would, so display:block
    // + symmetric padding leaves the text/icon visually off-center.
    display: "flex",
    alignItems: "center",
    width: "85%",
    margin: "0 auto",
    padding: "6px 18px",
    borderRadius: 9999,
    background: "#fff",
    color: PILL_INK,
    border: "none",
    fontSize: 14,
    fontWeight: 500,
    textAlign: "left",
    cursor: "pointer",
    lineHeight: 1.3,
  };
}

function cancelStyle(): React.CSSProperties {
  return {
    alignSelf: "flex-end",
    marginTop: 12,
    padding: "7px 22px",
    borderRadius: 9999,
    background: "transparent",
    color: PILL_INK,
    border: `1.5px solid ${PILL_INK}`,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  };
}
