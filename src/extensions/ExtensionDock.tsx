import React from "react";

export default function ExtensionDock() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "32px 0 16px" }}>
      <div
        className="card"
        style={{
          width: 340,
          maxWidth: "92vw",
          border: "3px solid #fff",
          padding: "14px 16px",
        }}
      >
        <div style={{ fontSize: 12, lineHeight: 1.5, fontWeight: 400, color: "#fff" }}>
          ⏳ <b>FUTURE FEATURE:</b> alerts about friends you're watching shows with. Have they caught up to you? Are they ahead? Are there posts or replies about shows you're watching together?
        </div>
      </div>
    </div>
  );
}
