import React from "react";

export default function LikeBadge({
  count, userLiked, onClick, title = "this post!", readOnly = false
}: { count: number; userLiked?: boolean; onClick?: (e: React.MouseEvent) => void; title?: string; readOnly?: boolean }) {
  const dots = Math.min(39, Math.max(0, count || 0));
  const reachedThis = (count || 0) >= 12;
  const clickable = !!onClick && !readOnly;
  const color = userLiked ? "var(--green)" : "var(--dos-fg)";
  return (
    <button
      className="likeWrap"
      onClick={clickable ? onClick : undefined}
      title={title}
      style={{
        border: "1px solid var(--dos-border)", borderRadius: 9999, padding: "2px 8px",
        color, background: "transparent", cursor: clickable ? "pointer" : "default"
      }}
    >
      <span className="likeDots">{'.'.repeat(dots)}</span>
      {reachedThis ? <span className="likeThis">this!</span> : <span className="likeBang">!</span>}
    </button>
  );
}
