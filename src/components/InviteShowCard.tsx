import React from "react";
import { X } from "lucide-react";
import TrailerCard from "./TrailerCard";
import { CANON } from "../styles/canon";
import { D, yellowCard, modalClose } from "./dashboardChrome";
import { M } from "../mobile/m";
import { preventLastWordOrphan } from "../lib/utils";

// The invite wall's show card (Alborz 2026-09-28): a version of the group
// room's yellow opt-in modal for the invited friend's landing. The show's
// name up top, the trailer beneath — and nothing else for the inviter's
// own shows (they'll be on the invitee's shelf no matter what). Desktop =
// the room's [yellow card + trailer] pair centred on a scrollable dim;
// /m = the room's full-screen yellow sheet with the × in a top bar.
// A browse thumbnail's card adds the yes/no toggle under the title via
// `children` (InviteShowSuggest owns that state).
export type InviteCardShow = { id: string; name: string; tvmazeId?: string | number | null };

export default function InviteShowCard({ idiom, show, onClose, children }: {
  idiom: "desktop" | "mobile";
  show: InviteCardShow;
  onClose: () => void;
  /** Rendered under the title, above the trailer (the toggle, when there is one). */
  children?: React.ReactNode;
}) {
  if (idiom === "mobile") {
    return (
      <div style={sheet} role="dialog" aria-label={show.name}>
        <div style={{ ...M.topBar, justifyContent: "flex-end" }}>
          <button style={M.iconBtn} onClick={onClose} aria-label="Close"><X size={20} color={CANON.cream} /></button>
        </div>
        <div style={sheetInner}>
          <div style={{ ...M.type.display, color: CANON.cream, textAlign: "center", marginBottom: children ? 24 : 0 }}>
            {preventLastWordOrphan(show.name)}
          </div>
          {children}
          <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
            <TrailerCard showId={show.id} tvmazeId={show.tvmazeId} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={column} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={yellowCard}>
          <button style={modalClose} onClick={onClose} aria-label="Close"><X size={20} color={CANON.cream} /></button>
          <div style={{ ...D.type.title, color: CANON.cream, textAlign: "center", marginBottom: children ? 24 : 0 }}>
            {preventLastWordOrphan(show.name)}
          </div>
          {children}
        </div>
        <TrailerCard showId={show.id} tvmazeId={show.tvmazeId} />
      </div>
    </div>
  );
}

// Desktop: the group room's trailer overlay + centre column (DashboardPage).
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(26,58,74,0.25)", zIndex: 50, overflowY: "auto",
  animation: "dDimIn 180ms ease-out",
};
const column: React.CSSProperties = {
  minHeight: "100%", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", gap: 16,
  padding: "24px 16px", boxSizing: "border-box",
};
// /m: the group room's click-model sheet (MobileGroupRoom).
const sheet: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, overflowY: "auto", background: CANON.accent,
  WebkitOverflowScrolling: "touch",
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)",
  boxSizing: "border-box",
};
const sheetInner: React.CSSProperties = { maxWidth: 420, margin: "0 auto", padding: "8px 20px 0" };
