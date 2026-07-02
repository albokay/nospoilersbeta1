import React from "react";
import { CANON } from "../styles/canon";
import SidebarLogo from "./SidebarLogo";

/**
 * Shown to every non-admin visitor on viewports narrower than 768px.
 * The site isn't yet usable on phone-sized screens, so the mobile entry
 * point is locked behind this single screen — no header, no feedback widget,
 * no sign-in, no invite-accept. Admins bypass this gate (see App.tsx).
 *
 * Matches the finale treatment in HomepageNarrative: scattered block logo
 * with the canonical "talk. together. whenever." tagline directly below.
 */
export default function MobileLockout() {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "var(--dos-bg)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 28,
      padding: "32px",
      boxSizing: "border-box",
      zIndex: 2147483646,
    }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <SidebarLogo scale={1} />
        <p style={{
          margin: 0, fontSize: 13, fontWeight: 700,
          letterSpacing: "0.12em", textTransform: "lowercase",
          color: CANON.cream,
        }}>
          talk. together. whenever.
        </p>
      </div>
      <p style={{
        margin: 0,
        maxWidth: 320,
        fontSize: 16, fontWeight: 600, lineHeight: 1.5,
        color: CANON.cream, textAlign: "center",
      }}>
        Sidebar isn&rsquo;t ready for your phone yet. Please sign up / sign in on your desktop.
      </p>
    </div>
  );
}
