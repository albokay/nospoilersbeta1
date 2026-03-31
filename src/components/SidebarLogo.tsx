import React, { useState } from "react";

const LOGOS = [
  "/sidebar-logo-1.png",
  "/sidebar-logo-2.png",
  "/sidebar-logo-3.png",
  "/sidebar-logo-4.png",
];

const picked = LOGOS[Math.floor(Math.random() * LOGOS.length)];

export interface SidebarLogoProps {
  scale?: number;
}

export default function SidebarLogo({ scale = 1 }: SidebarLogoProps) {
  return (
    <img
      src={picked}
      alt="sidebar"
      style={{
        width: 729 * scale,
        height: 402 * scale,
        display: "block",
        userSelect: "none",
        maxWidth: "92vw",
      }}
    />
  );
}
