import React, { useState } from "react";
import Modal from "./Modal";

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

  const [showHint, setShowHint] = useState(false);

  // ☆ = not yet starred by this user, ⭐️ = starred by this user
  const icon = userLiked ? "⭐️" : "☆";

  const handleClick = (e: React.MouseEvent) => {
    if (!clickable) return;
    onClick?.(e);
    // TODO before shipping: wrap in `if (!localStorage.getItem("ns_star_hint_seen"))`
    setShowHint(true);
  };

  return (
    <>
      {showHint && (
        <Modal onClose={() => setShowHint(false)} width="min(520px,92vw)" cardClassName="explanation-card">
          <div style={{ padding: "16px 12px 12px" }}>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, fontWeight: 700 }}>
              ⭐ Starring is just for you.
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              Starring a post saves it to your private profile page. Entries never get public "like counts."
            </p>
            <p style={{ margin: "0 0 32px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              In fact, Sidebar will never quantify relationship or conversations anywhere on the site.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn"
                style={{ fontSize: 15, padding: "8px 24px" }}
                onClick={() => {
                  localStorage.setItem("ns_star_hint_seen", "1");
                  setShowHint(false);
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </Modal>
      )}

      <button
        className="likeWrap"
        onClick={handleClick}
        title={clickable ? (userLiked ? "Un-star" : title) : undefined}
        style={{
          border: "2px solid var(--dos-border)",
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
    </>
  );
}
