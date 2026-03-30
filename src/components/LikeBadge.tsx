import React from "react";

// Threshold at which the star becomes 🤩 "this!"
const HOT_THRESHOLD = 20;

export default function LikeBadge({
  count: rawCount, userLiked, onClick, title = "Like", readOnly = false
}: {
  count: number;
  userLiked?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  readOnly?: boolean;
}) {
  const count = Math.max(0, rawCount || 0);
  const clickable = !!onClick && !readOnly;
  const isHot = count >= HOT_THRESHOLD;
  const active = userLiked || count > 0;

  return (
    <button
      className="likeWrap"
      onClick={clickable ? onClick : undefined}
      title={clickable ? title : undefined}
      style={{
        border: "1px solid var(--dos-border)",
        borderRadius: 9999,
        padding: "3px 9px",
        background: "transparent",
        cursor: clickable ? "pointer" : "default",
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        opacity: active ? 1 : 0.35,
        transition: "opacity 150ms",
        color: "var(--dos-fg)",
      }}
    >
      {/* Main icon */}
      <span style={{ fontSize: 14, lineHeight: 1 }}>
        {isHot ? "🤩" : "⭐️"}
      </span>

      {/* "this!" label when hot */}
      {isHot && (
        <span className="likeThis" style={{ fontSize: 12, fontWeight: 700, fontStyle: "italic" }}>
          this!
        </span>
      )}

      {/* Count — only shown when ≥ 2 */}
      {count >= 2 && (
        <sub style={{ fontSize: 10, fontWeight: 700, lineHeight: 1 }}>
          {count}
        </sub>
      )}
    </button>
  );
}
