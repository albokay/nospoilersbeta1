import React from "react";
import { CANON, ROLE, withAlpha } from "../styles/canon";

// ============================================================================
// Button — structural button primitive (adapted from the Claude Design draft).
// ----------------------------------------------------------------------------
// Governs the fill/outline STRUCTURE only — it does NOT decide which brand
// color a button is. Publishing/action buttons across the app have several
// colors; preserve each button's current color (mapped to the nearest canon-8)
// and pass it via `toneColor`. The variants are structural (solid vs no-fill),
// not brand roles. Do NOT introduce a single canonical "post" color.
//
// HARD RULES (from the standardization pass):
//   1. No pure white. On-frame light text/outline is CANON.cream, never #FEF8EA.
//   2. Fill and outline are NEVER different colors. Every button is either
//      SOLID (background === borderColor) or NO-FILL (transparent, outline
//      only). This invariant holds through hover too.
//
// NOTE: this primitive is opinionated — it adds a hover state and uses cream
// for light text. It is NOT a drop-in for existing fixed-inline buttons that
// have no hover; migrate call sites deliberately, not as a "no visual change"
// pass. The many className=".btn" buttons are context-themed via theme.ts and
// should stay there until the theme.ts → canon-var bridge lands.
// ============================================================================

type ButtonVariant =
  | "solid"       // SOLID: fill === outline (pass color via toneColor); cream text
  | "outline"     // NO-FILL: transparent fill, outline === text (via toneColor)
  | "dangerSolid" // SOLID red fill (destructive confirm)
  | "danger"      // NO-FILL red outline + red text → fills red on hover
  | "ghost";      // no border, subtle hover — for close-X-like affordances

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** The button's color, mapped to a canon-8 value. For `solid` it's the fill
   *  (outline matches); for `outline` it's the outline+text. Preserve each
   *  button's CURRENT color — the primitive doesn't pick it. */
  toneColor?: string;
}

const RADIUS_PILL = 9999;

function styleFor(variant: ButtonVariant, tone?: string): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: RADIUS_PILL,
    padding: "8px 16px",
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    border: "2px solid transparent",
    background: "transparent",
    lineHeight: 1.2,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  };
  switch (variant) {
    case "solid": {
      const fill = tone ?? CANON.cream;
      const text = fill === CANON.cream ? CANON.dark : CANON.cream;
      return { ...base, background: fill, color: text, borderColor: fill };
    }
    case "dangerSolid":
      return { ...base, background: ROLE.danger, color: CANON.cream, borderColor: ROLE.danger };
    case "outline": {
      const line = tone ?? "currentColor";
      return { ...base, color: line, borderColor: line };
    }
    case "danger":
      return { ...base, color: ROLE.danger, borderColor: ROLE.danger };
    case "ghost":
      return { ...base, color: tone ?? "currentColor", borderColor: "transparent", padding: "6px 10px" };
    default:
      return base;
  }
}

export default function Button({
  variant = "outline",
  toneColor,
  style,
  children,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = React.useState(false);
  const resolved = { ...styleFor(variant, toneColor), ...style };

  // Hover, derived from canon so a swap flows through. The fill===outline
  // invariant is preserved: solid variants move fill AND border together;
  // no-fill variants only tint the transparent fill, never the outline.
  if (hover) {
    if (variant === "solid") {
      const hot = withAlpha(toneColor ?? CANON.cream, 0.86);
      resolved.background = hot; resolved.borderColor = hot;
    } else if (variant === "dangerSolid") {
      const hot = withAlpha(CANON.alert, 0.9);
      resolved.background = hot; resolved.borderColor = hot;
    } else if (variant === "danger") {
      resolved.background = ROLE.danger; resolved.color = CANON.cream; resolved.borderColor = ROLE.danger;
    } else {
      resolved.background = withAlpha(CANON.dark, 0.08); // faint wash, outline untouched
    }
  }

  return (
    <button
      {...rest}
      onMouseEnter={(e) => { setHover(true); rest.onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHover(false); rest.onMouseLeave?.(e); }}
      style={resolved}
    >
      {children}
    </button>
  );
}
