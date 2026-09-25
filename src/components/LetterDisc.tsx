import React from "react";
import { Mail, MailOpen } from "lucide-react";
import { CANON } from "../styles/canon";

// The letters grammar's room-level signal (Alborz 2026-09-25): a disc with
// an envelope where a room row or a group cluster used to carry a plain
// dot. "open" = Identity disc + open envelope, writing you can read now;
// "sealed" = Alert disc + closed envelope, writing for you that waits until
// you catch up. Cream glyph on both; 22px where the dot was 16. The map
// keeps its dots — this is for shelves and dashboards only.
export default function LetterDisc({ kind, size = 22, className, style }: {
  kind: "open" | "sealed";
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Glyph = kind === "open" ? MailOpen : Mail;
  return (
    <span
      className={className}
      aria-hidden
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: kind === "open" ? CANON.identity : CANON.alert,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        ...style,
      }}
    >
      <Glyph size={Math.round(size * 0.6)} color={CANON.cream} strokeWidth={2.2} />
    </span>
  );
}
