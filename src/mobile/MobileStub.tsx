import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { CANON } from "../styles/canon";

/**
 * Placeholder for drill-down destinations that later checkpoints build
 * (group room = CP4, show room = CP6, …). Keeps navigation honest during
 * the rebuild: taps land somewhere real with a working way back, instead
 * of dead buttons. Only admins can reach any of this while the lockout is
 * in force.
 */
export default function MobileStub({ label, backTo = "/m/dashboard" }: { label: string; backTo?: string }) {
  const navigate = useNavigate();
  return (
    <div
      style={{
        minHeight: "100dvh",
        boxSizing: "border-box",
        background: "var(--dos-bg, var(--canon-personal,#7abd8e))",
        color: CANON.cream,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: "32px",
        textAlign: "center",
      }}
    >
      <p style={{ margin: 0, maxWidth: 320, fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>
        {label} — being rebuilt.
      </p>
      <button
        onClick={() => navigate(backTo)}
        style={{
          minHeight: 44,
          padding: "10px 24px",
          borderRadius: 999,
          border: `2px solid ${CANON.cream}`,
          background: "transparent",
          color: CANON.cream,
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <ArrowLeft size={16} /> back
      </button>
    </div>
  );
}
