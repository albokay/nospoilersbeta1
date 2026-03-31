import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
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
      <div className="card" style={{
        position: "relative", width: "min(820px,92vw)", background: "rgba(201,168,67,0.98)",
        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
        padding: "16px 20px",
      }}>
        {children}
      </div>
    </div>
  );

  return createPortal(modal, nodeRef.current);
}
