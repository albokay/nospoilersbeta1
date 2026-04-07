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
}: {
  name: string;
  onClickProfile: (username: string) => void;
  bold?: boolean;
}) {
  const Tag = bold ? "b" : "span";

  if (SEED_AUTHORS.has(name)) {
    return <Tag className="username">@{name}</Tag>;
  }

  return (
    <Tag
      className="username"
      style={{ cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}
      onClick={(e) => { e.stopPropagation(); onClickProfile(name); }}
      title={`View ${name}'s profile`}
    >
      @{name}
    </Tag>
  );
}
