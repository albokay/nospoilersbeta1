import React from "react";

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

  // ☆ = not yet liked by this user, ⭐️ = liked by this user, 🤩 = hot threshold
  const icon = isHot ? "🤩" : userLiked ? "⭐️" : "☆";

  // Dim only when truly inactive (no likes at all, not liked by user)
  const dimmed = count === 0 && !userLiked;

  return (
    <button
      className="likeWrap"
      onClick={clickable ? onClick : undefined}
      title={clickable ? (userLiked ? "Already liked" : title) : undefined}
      style={{
        border: "1px solid var(--dos-border)",
        borderRadius: 9999,
        padding: "3px 9px",
        background: "transparent",
        cursor: clickable && !userLiked ? "pointer" : "default",
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        opacity: dimmed ? 0.35 : 1,
        transition: "opacity 150ms",
        color: "var(--dos-fg)",
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>

      {isHot && (
        <span className="likeThis" style={{ fontSize: 12, fontWeight: 700, fontStyle: "italic" }}>
          this!
        </span>
      )}

      {count >= 2 && (
        <sub style={{ fontSize: 10, fontWeight: 700, lineHeight: 1 }}>
          {count}
        </sub>
      )}
    </button>
  );
}
