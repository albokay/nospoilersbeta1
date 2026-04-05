import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function Modal({ children, onClose, topContent, width, cardStyle }: { children: React.ReactNode; onClose: () => void; topContent?: React.ReactNode; width?: string; cardStyle?: React.CSSProperties }) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  if (!nodeRef.current) {
    nodeRef.current = document.createElement("div");
    nodeRef.current.setAttribute("data-modal-root", "true");
  }
  useEffect(() => {
    const node = nodeRef.current!;
    document.body.appendChild(node);
    return () => { try { document.body.removeChild(node); } catch {} };
  }, []);

  const modal = (
    <div style={{ position: "fixed", inset: 0, zIndex: 2147483000, display: "grid", placeItems: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.35)" }} />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: width ?? "min(820px,92vw)" }}>
        {topContent && (
          <div className="card" style={{
            width: "100%", background: "rgba(255,255,255,0.97)",
            backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)", padding: "14px 20px",
            color: "#222", fontWeight: 600, fontSize: 15, textAlign: "center",
          }}>
            {topContent}
          </div>
        )}
        <div className="card" style={{
          width: "100%", background: "var(--dos-bg)",
          backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
          padding: "16px 20px",
          ...cardStyle,
        }}>
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, nodeRef.current);
}
