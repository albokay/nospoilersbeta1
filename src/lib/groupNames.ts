/**
 * Dual-mode group naming (social-onboarding CP2, 2026-07-06).
 *
 * A custom group name (set by anyone via rename) is GLOBAL and always wins.
 * Otherwise each viewer sees the group named by the names THEY gave its
 * members (phone-contacts model): contact names for accepted members (handle
 * fallback for anyone the viewer hasn't named), plus the names on the
 * viewer's own still-pending invites into the group. With no other people at
 * all, falls back to the stable "Group N".
 */
import type { PeopleGroup, PeopleGroupMember } from "../types";

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

export function groupDisplayName(
  group: PeopleGroup,
  others: PeopleGroupMember[],
  contactNames: Record<string, string>,
  pendingNames: string[] = [],
): string {
  if (group.name) return group.name;
  const names = [
    ...others.map((m) => contactNames[m.userId] ?? m.username),
    ...pendingNames,
  ].filter(Boolean);
  if (names.length) return joinNames(names);
  if (group.seq != null) return `Group ${group.seq}`;
  return "Group";
}
