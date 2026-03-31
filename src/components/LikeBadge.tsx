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

  return (
    <button
      className="likeWrap"
      onClick={clickable ? onClick : undefined}
      title={clickable ? (userLiked ? "Already liked" : title) : undefined}
      style={{
        border: "3px solid var(--dos-border)",
        borderRadius: 9999,
        padding: "5px 14px",
        background: "transparent",
        cursor: clickable && !userLiked ? "pointer" : "default",
        display: "inline-flex",
        alignItems: "baseline",
        gap: 5,
        color: "var(--dos-fg)",
      }}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>

      {isHot && (
        <span className="likeThis" style={{ fontSize: 18, fontWeight: 700, fontStyle: "italic" }}>
          this!
        </span>
      )}

      {count >= 2 && (
        <sub style={{ fontSize: 15, fontWeight: 700, lineHeight: 1 }}>
          {count}
        </sub>
      )}
    </button>
  );
}
