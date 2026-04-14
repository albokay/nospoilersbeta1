import React, { useState } from "react";
import { Star } from "lucide-react";
import Modal from "./Modal";

export default function LikeBadge({
  count: rawCount, userLiked, onClick, title = "Like", readOnly = false, inReply = false
}: {
  count: number;
  userLiked?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  readOnly?: boolean;
  inReply?: boolean;
}) {
  // count is kept in props so callers can still pass it for backend ordering,
  // but it is intentionally not rendered.
  void rawCount;
  const clickable = !!onClick && !readOnly;

  const [showHint, setShowHint] = useState(false);

  // Outline star = not yet starred, filled star = starred by this user
  // inReply uses currentColor so CSS context overrides (e.g. public-context green) take effect
  const starColor = inReply ? "currentColor" : "#fff";
  const icon = <Star size={14} fill={userLiked ? starColor : "none"} color={starColor} />;

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
              <Star size={14} fill="currentColor" color="currentColor" /> Starring is just for you.
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              Starring a post saves it to your private profile page. Entries never get public "like counts."
            </p>
            <p style={{ margin: "0 0 32px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              In fact, Sidebar will never quantify relationships or conversations anywhere on the site.
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
          border: `2px solid ${inReply ? "currentColor" : "#fff"}`,
          borderRadius: "50%",
          width: 32,
          height: 32,
          padding: 0,
          background: "transparent",
          cursor: clickable ? "pointer" : "default",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: inReply ? "var(--dos-fg)" : "#fff",
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
      </button>
    </>
  );
}
