import React from "react";

export default function ExtensionDock() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0 16px 40px" }}>
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 460,
          border: "3px solid #fff",
          padding: "14px 16px",
        }}
      >
        <div style={{ fontSize: 15, lineHeight: 1.6, fontWeight: 400, color: "#fff" }}>
          ⏳ <b>FUTURE FEATURE:</b> alerts about friends you're watching shows with. Have they caught up to you? Are they ahead? Are there new posts or replies about shows you're watching together?
        </div>
      </div>
    </div>
  );
}
