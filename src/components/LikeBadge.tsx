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
          <div style={{ padding: "16px 10px 10px" }}>
            <p style={{ margin: "0 0 20px", fontSize: 22, lineHeight: 1.7, fontWeight: 500 }}>
              ⭐ Starring a post saves it to your private profile page.
            </p>
            <p style={{ margin: "0 0 20px", fontSize: 22, lineHeight: 1.7, fontWeight: 500 }}>
              Entries never get public "like counts." In fact, there is no quantifying of relationships or conversations anywhere on the site.
            </p>
            <p style={{ margin: "0 0 36px", fontSize: 19, lineHeight: 1.7, opacity: 0.65, fontStyle: "italic" }}>
              Starring is just for you.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn"
                style={{ fontSize: 16, padding: "10px 24px" }}
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
    </>
  );
}
