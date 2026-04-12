export type Thread = {
  id: string; showId: string; season: number; episode: number;
  author: string; titleBase: string; preview: string; body: string; updatedAt: number;
  likes: number;
  isPublic?: boolean;   // true = visible on aggregated show page; false = journal-only (default)
  isDeleted?: boolean;
  isEdited?: boolean;
  isRewatch?: boolean;
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
  author: string; body: string; updatedAt: number; replyToId?: string;
  likes: number;
  isDeleted?: boolean;
  isEdited?: boolean;
  isRewatch?: boolean;
  // Reference system fields
  referenceType?: 'quote' | 'link' | null;
  referencedReplyId?: string | null;
  referencedThreadId?: string | null;
  quotedText?: string | null;
};

// Extended progress entry — carries rewatch metadata alongside the feed-filter position
export type ProgressEntry = {
  s: number;
  e: number;
  isRewatching?: boolean;
  rewatchS?: number;
  rewatchE?: number;
  highestS?: number;
  highestE?: number;
};
