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
 */
import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { CANON } from "../styles/canon";

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

export default function InviteLinkRow({ name, link, tone }: InviteLink & { tone: "cream" | "sky" }) {
  const [copied, setCopied] = useState(false);
  const ink = tone === "cream" ? CANON.identity : CANON.cream;
  function copy() {
    try { navigator.clipboard?.writeText(link); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
          color: copied ? (tone === "cream" ? CANON.cream : CANON.friend) : ink,
          display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0,
        }}
      >
        {copied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} strokeWidth={2.2} />}
      </button>
    </div>
  );
}
