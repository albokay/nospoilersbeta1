/**
 * Shared modal/overlay chrome for the live dashboard world (2026-07-06,
 * onboarding look-and-feel pass). These style objects used to live inline in
 * DashboardPage / ShowRoomPage; they moved here UNCHANGED so the social
 * onboarding can render the site's REAL surfaces (search card, picker card,
 * invite card, compose shell, accent confirm card) instead of approximations
 * — one source, no drift. Values are byte-identical to the originals
 * (C.green ⇒ CANON.personal, etc.).
 */
import type React from "react";
import { CANON } from "../styles/canon";

export const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(26,58,74,0.25)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 50,
};

export const searchCard: React.CSSProperties = { background: CANON.cream, borderRadius: 24, padding: 32, width: "min(560px, 86vw)" };

export const pickerCard: React.CSSProperties = {
  background: CANON.cream, borderRadius: 24, padding: "40px 48px", width: "min(640px, 88vw)",
  display: "flex", flexDirection: "column", alignItems: "center",
};

export const searchInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `2px solid ${CANON.personal}`, borderRadius: 65,
  padding: "14px 24px", fontFamily: '"Inter", sans-serif', fontSize: 14, color: CANON.personal,
  background: "transparent", outline: "none",
};

export const modalClose: React.CSSProperties = {
  position: "absolute", top: 16, right: 16, border: "none", background: "transparent", cursor: "pointer",
};

export const yellowCard: React.CSSProperties = {
  background: CANON.accent, borderRadius: 15, padding: "28px 32px", width: "min(360px, 88vw)",
  position: "relative", textAlign: "center",
};

export const yellowTitle: React.CSSProperties = {
  color: CANON.cream, fontSize: 15, fontWeight: 600, letterSpacing: -0.5,
};

export const startBtn: React.CSSProperties = {
  border: "none", background: CANON.identity, color: CANON.cream, fontWeight: 700, fontSize: 14,
  padding: "11px 38px", borderRadius: 65, cursor: "pointer",
};

export const invitePill: React.CSSProperties = {
  border: "none", background: CANON.identity, color: CANON.cream, fontWeight: 700, fontSize: 14,
  padding: "18px 64px", borderRadius: 65, cursor: "pointer", boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};

export const searchPill: React.CSSProperties = {
  border: "none", background: CANON.accent, color: CANON.cream, fontWeight: 700, fontSize: 14,
  padding: "16px 56px", borderRadius: 65, cursor: "pointer",
};

// The show room's compose shell (ShowRoomPage) — the "regular compose modal".
export const composeBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 1000,
};

export const composeCardOuter: React.CSSProperties = {
  position: "relative", width: "85vw", height: "90vh", background: CANON.cream,
  borderRadius: 24, boxShadow: "0 12px 36px rgba(0,0,0,0.25)", overflow: "auto",
};
