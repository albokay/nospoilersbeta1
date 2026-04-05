import React from "react";

export default function LikeBadge({
  count: rawCount, userLiked, onClick, title = "Like", readOnly = false
}: {
  count: number;
  userLiked?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  readOnly?: boolean;
}) {
  // count is kept in props so callers can still pass it for backend ordering,
  // but it is intentionally not rendered.
  void rawCount;
  const clickable = !!onClick && !readOnly;

  // ☆ = not yet starred by this user, ⭐️ = starred by this user
  const icon = userLiked ? "⭐️" : "☆";

  return (
    <button
      className="likeWrap"
      onClick={clickable ? onClick : undefined}
      title={clickable ? (userLiked ? "Un-star" : title) : undefined}
      style={{
        border: "3px solid var(--dos-border)",
        borderRadius: 9999,
        padding: "4px 11px",
        background: "transparent",
        cursor: clickable ? "pointer" : "default",
        display: "inline-flex",
        alignItems: "baseline",
        color: "var(--dos-fg)",
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
    </button>
  );
}
