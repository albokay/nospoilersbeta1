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
  viewerNumber?: number,
): string {
  if (group.name) return group.name;
  const names = [
    ...others.map((m) => contactNames[m.userId] ?? m.displayName ?? m.username),
    ...pendingNames,
  ].filter(Boolean);
  if (names.length) return joinNames(names);
  return groupGenericName(group, viewerNumber);
}

/** The group's GENERIC label — custom name if set, else "Group N" where N is
 *  the VIEWER's number for it (their Nth group by join order — per-viewer, so
 *  a rail can never hold two "Group 1"s; the old per-creator seq is only the
 *  last-resort fallback). Used as the group room header's title, where the
 *  people belong to the "with…" line instead (2026-07-07 naming arc). */
export function groupGenericName(group: PeopleGroup, viewerNumber?: number): string {
  if (group.name) return group.name;
  const n = viewerNumber ?? group.seq;
  return n != null ? `Group ${n}` : "Group";
}

/** One person's display name through the viewer's eyes: the name the viewer
 *  gave them (phone-contacts model) → their self-chosen first name
 *  (profiles.display_name, first-name identity arc) → their handle as the
 *  last resort. Bare — never "@". Callers pass displayName when the person
 *  object at hand carries it (members/chat/map rows all do since CP2). */
export function personDisplayName(contactNames: Record<string, string>, userId: string, username: string, displayName?: string | null): string {
  return contactNames[userId] ?? displayName ?? username;
}
