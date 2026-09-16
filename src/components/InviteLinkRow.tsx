/**
 * InviteLinkRow — "[friend name]: beta.sidebar.watch/group-invite/3f2a…" + a
 * copy button (Alborz 2026-08-18, text-a-link invites). Shown on the invite
 * confirmation screens (the onboarding "You're in!" card + both "Invites
 * sent!" screens) so the inviter can ALSO text the same invite their friend
 * was just emailed. The link is the invite email's own link — nothing about
 * the invite changes; this is a second delivery channel. Display is
 * shortened; the copy button copies the FULL link.
 *
 * tone: "cream" = on the cream card (Identity ink); "sky" = on the sky
 * invite modal/sheet (Cream ink).
 *
 * Pass 3 (2026-09-15): the CREAM tone is the standard on-cream field —
 * sky inset ring, full stadium, 48 tall (44 with mobileIdiom), Identity
 * name + link, an Identity-fill S "Copy" pill. The sky tone keeps its
 * text-plus-circle look (the invite sheet/panel fallback links).
 */
import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { CANON } from "../styles/canon";
import { D } from "./dashboardChrome";

export type InviteLink = { name: string; link: string };

/** "beta.sidebar.watch/group-invite/3f2a…" — host + first 4 of the token. */
export function shortInviteLink(link: string): string {
  try {
    const u = new URL(link);
    const parts = u.pathname.split("/");
    const token = parts[parts.length - 1] ?? "";
    return `${u.host}${parts.slice(0, -1).join("/")}/${token.slice(0, 4)}…`;
  } catch {
    return link.length > 40 ? `${link.slice(0, 40)}…` : link;
  }
}

export default function InviteLinkRow({ name, link, tone, mobileIdiom = false }: InviteLink & { tone: "cream" | "sky"; mobileIdiom?: boolean }) {
  const [copied, setCopied] = useState(false);
  const ink = tone === "cream" ? CANON.identity : CANON.cream;
  function copy() {
    try { navigator.clipboard?.writeText(link); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  if (tone === "cream") {
    const fs = mobileIdiom ? 13 : 14;
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 10, minWidth: 0, boxSizing: "border-box",
        background: CANON.cream, borderRadius: 9999, boxShadow: `inset 0 0 0 2px ${CANON.friend}`,
        minHeight: mobileIdiom ? 44 : 48, padding: mobileIdiom ? "6px 6px 6px 16px" : "6px 6px 6px 20px",
      }}>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: fs, color: CANON.identity, flexShrink: 0 }}>{name}</span>
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: fs, color: CANON.identity, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {shortInviteLink(link)}
        </span>
        <button
          onClick={copy}
          aria-label={copied ? "copied" : `copy ${name}'s invite link`}
          style={{ ...D.pill.S, background: CANON.identity, color: CANON.cream, flexShrink: 0 }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 14, lineHeight: 1.6, color: ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}: <span style={{ fontWeight: 500, opacity: 0.85 }}>{shortInviteLink(link)}</span>
      </span>
      <button
        onClick={copy}
        aria-label={copied ? "copied" : `copy ${name}'s invite link`}
        title={copied ? "copied!" : "copy link"}
        style={{
          flexShrink: 0, width: 30, height: 30, borderRadius: "50%", cursor: "pointer",
          border: `2px solid ${ink}`, background: copied ? ink : "transparent",
          color: copied ? CANON.friend : ink,
          display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0,
        }}
      >
        {copied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} strokeWidth={2.2} />}
      </button>
    </div>
  );
}
