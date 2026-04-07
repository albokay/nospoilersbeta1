import React from "react";
import { SEED_AUTHORS } from "../lib/mockData";

/**
 * Renders a username as plain text if it's a seeded/fake account,
 * or as a clickable link if it's a real DB user.
 */
export default function Username({
  name,
  onClickProfile,
  bold = false,
  isOwn = false,
}: {
  name: string;
  onClickProfile: (username: string) => void;
  bold?: boolean;
  isOwn?: boolean;
}) {
  const Tag = bold ? "b" : "span";
  const ownStyle: React.CSSProperties = isOwn ? { color: "var(--dos-user)" } : {};

  if (SEED_AUTHORS.has(name)) {
    return <Tag className="username" style={ownStyle}>@{name}</Tag>;
  }

  return (
    <Tag
      className="username"
      style={{ cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2, ...ownStyle }}
      onClick={(e) => { e.stopPropagation(); onClickProfile(name); }}
      title={`View ${name}'s profile`}
    >
      @{name}
    </Tag>
  );
}
