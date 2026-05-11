export type Thread = {
  id: string; showId: string; season: number; episode: number;
  author: string; titleBase: string; preview: string; body: string;
  createdAt: number; updatedAt: number;
  likes: number;
  isPublic?: boolean;   // true = visible on aggregated show page; false = journal-only (default)
  isDeleted?: boolean;
  isEdited?: boolean;
  isRewatch?: boolean;
  // For rewatch posts: the rewatch position frozen at time of writing.
  // season/episode above is the filter tag (= highest at time of writing).
  rewatchS?: number;
  rewatchE?: number;
  isMoved?: boolean;      // true = entry was moved to public; stub shown in friend room
  sourceThreadId?: string; // if this IS the public clone, points to the friend-room original
};

// ── Friend groups ─────────────────────────────────────────────────────────────

export type FriendGroup = {
  id: string;
  showId: string;
  name: string;
  createdBy: string;
  createdAt: number;
};

export type FriendGroupMember = {
  groupId: string;
  userId: string;
  username: string;
  joinedAt: number;
};

// ── Invitations ───────────────────────────────────────────────────────────────

export type Invitation = {
  id: string;
  groupId: string;
  createdBy: string;
  inviteeEmail: string;
  token: string;
  expiresAt: number;
  acceptedAt: number | null;
  createdAt: number;
};

export type Reply = {
  id: string; threadId: string; showId: string; season: number; episode: number;
  author: string; body: string; createdAt: number; updatedAt: number; replyToId?: string;
  likes: number;
  isDeleted?: boolean;
  isEdited?: boolean;
  isRewatch?: boolean;
  rewatchS?: number;
  rewatchE?: number;
  // Reference system fields
  referenceType?: 'quote' | 'link' | null;
  referencedReplyId?: string | null;
  referencedThreadId?: string | null;
  quotedText?: string | null;
};

// ── Polls ─────────────────────────────────────────────────────────────────

export type PollDurationCode = "24h" | "3d" | "1w";

export type Poll = {
  id: string;
  askerId: string;
  groupId: string;
  question: string;
  allowWriteIn: boolean;
  duration: PollDurationCode;
  createdAt: number;
  closedAt: number | null;
};

export type PollOption = {
  id: string;
  pollId: string;
  optionText: string;
  displayOrder: number;
};

export type PollResponse = {
  id: string;
  pollId: string;
  responderId: string;
  optionId: string | null;
  writeInText: string | null;
  respondedAt: number;
};

// ── Pings ─────────────────────────────────────────────────────────────────────

export type PingType = 'nudge_ahead' | 'nudge_same' | 'nudge_behind';

export type Ping = {
  id: string;
  senderId: string;
  recipientId: string;
  showId: string;
  groupId: string;
  pingType: PingType;
  message: string | null;
  sentAt: number;
  dismissedAt: number | null;
  // Resolved at fetch time when needed (e.g. for the in-room sticky which
  // displays "@sender pinged you:"). Not always populated.
  senderUsername?: string;
};

// Extended progress entry — carries rewatch metadata alongside the feed-filter position.
// v2 (2026-05-08): also carries the four-status flag, canon-pin, and four shelf blurbs.
// All v2 fields are optional so legacy callers that don't read them stay correct.
export type ProgressEntry = {
  s: number;
  e: number;
  isRewatching?: boolean;
  rewatchS?: number;
  rewatchE?: number;
  highestS?: number;
  highestE?: number;
  // v2 — four-status show model + curatorial pin + per-shelf blurbs.
  stoppedWatching?: boolean;
  canonPin?: boolean;
  watchingQuote?: string;
  wantReason?: string;
  canonTake?: string;
  stoppedReason?: string;
  // v2 profile-display layer (2026-05-11). Purely visual organization on
  // the V2 profile page. shelfOverride pins a row to a specific shelf
  // regardless of progress (null = derive); shelfPosition orders rows
  // within their resolved shelf (null = fall back to alphabetical).
  // Never affect spoiler filtering, post tagging, or behavior outside
  // the V2 profile UI.
  shelfOverride?: "watching" | "want" | "finished" | "stopped" | null;
  shelfPosition?: number | null;
};
