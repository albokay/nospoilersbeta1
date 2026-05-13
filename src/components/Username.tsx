import React from "react";
import { SEED_AUTHORS } from "../lib/mockData";
import SidebarAvatar from "./SidebarAvatar";

/**
 * Renders a username as plain text if it's a seeded/fake account,
 * or as a clickable link if it's a real DB user.
 *
 * The Boring Avatar takes the place of the "@" glyph — avatar and "@"
 * are mutually exclusive. Seeded names have no user-id; the avatar
 * falls back to name-as-seed.
 */
export default function Username({
  name,
  userId,
  onClickProfile,
  bold = false,
  avatarSize = 16,
}: {
  name: string;
  userId?: string | null;
  onClickProfile: (username: string) => void;
  bold?: boolean;
  avatarSize?: number;
}) {
  const Tag = bold ? "b" : "span";
  const inner = (
    <>
      <SidebarAvatar userId={userId} username={name} size={avatarSize} />
      <span>{name}</span>
    </>
  );

  if (SEED_AUTHORS.has(name)) {
    return (
      <Tag className="username" style={{ display: "inline-flex", alignItems: "center", gap: 6, verticalAlign: "middle" }}>
        {inner}
      </Tag>
    );
  }

  return (
    <Tag
      className="username"
      style={{
        cursor: "pointer",
        textDecoration: "underline",
        textUnderlineOffset: 2,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        verticalAlign: "middle",
      }}
      onClick={(e) => { e.stopPropagation(); onClickProfile(name); }}
      title={`View ${name}'s profile`}
    >
      {inner}
    </Tag>
  );
}
