/**
 * JournalCard.tsx — the one-time card a handed-over journal leaves in the
 * room (the journal arc, 2026-10-26; his boards "Sam's room · the journal
 * arrived"). The grey band in the letter-from-Sidebar's slot: "Yalborz
 * opened their journal to you." / "Finished spring 2024" / his body with the
 * date phrase. The × closes it for good on this device.
 */
import React from "react";
import { X } from "lucide-react";
import { E } from "../../styles/editorial";

export default function JournalCard({ name, dateLabel, count, from, to, written, desktop = false, onClose, style }: {
  name: string;
  /** "Finished spring 2024" / "Last written spring 2024". */
  dateLabel: string;
  count: number;
  from: { s: number; e: number };
  to: { s: number; e: number };
  /** "in 2024" / "earlier this year" / "a few weeks ago". */
  written: string;
  desktop?: boolean;
  onClose: () => void;
  style?: React.CSSProperties;
}) {
  const range = from.s === to.s && from.e === to.e ? `S${from.s} E${from.e}` : `S${from.s} E${from.e} to S${to.s} E${to.e}`;
  return (
    <div role="note" aria-label={`${name} opened their journal to you.`} style={{ position: "relative", background: E.color.draft, color: E.color.ink, padding: desktop ? "20px 56px 20px 22px" : "18px 44px 18px 18px", ...style }}>
      <button type="button" aria-label="Close" onClick={onClose} style={{ position: "absolute", right: desktop ? 8 : 6, top: desktop ? 8 : 6, width: 36, height: 36, border: 0, background: "transparent", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <X size={18} strokeWidth={1.8} color={E.color.ink} />
      </button>
      <div style={{ ...E.type.letterTitle22, fontSize: desktop ? 24 : 22, textWrap: "balance" } as React.CSSProperties}>{name} opened their journal to you.</div>
      <div style={{ ...E.type.label11, marginTop: 8 }}>{dateLabel}</div>
      <div style={{ fontFamily: E.font.interface, fontSize: desktop ? 15 : 14, lineHeight: 1.5, marginTop: 10, textWrap: "pretty" } as React.CSSProperties}>
        {count} {count === 1 ? "entry" : "entries"} from {range}, written {written}. Each journal entry unseals like a regular letter — a time capsule of their thoughts, arriving to you new as you catch up.
      </div>
    </div>
  );
}
