/**
 * TipText — renders tip copy, swapping the ⚙️/💬 emoji tokens for the
 * Lucide icons they refer to (Settings = the group gear, MessageCircle =
 * the chat tab), so the notes show the exact marks the page uses
 * (help-system QA round 2). Content strings keep the emoji as tokens —
 * tipsContent stays a plain .ts data module.
 */
import React from "react";
import { Settings, MessageCircle } from "lucide-react";

const iconStyle: React.CSSProperties = { display: "inline", verticalAlign: "-2px" };

export default function TipText({ text }: { text: string }) {
  const parts = text.split(/(⚙️|💬)/);
  return (
    <>
      {parts.map((p, i) =>
        p === "⚙️" ? <Settings key={i} size={13} style={iconStyle} />
        : p === "💬" ? <MessageCircle key={i} size={13} style={iconStyle} />
        : <React.Fragment key={i}>{p}</React.Fragment>
      )}
    </>
  );
}
