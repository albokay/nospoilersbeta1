export type Thread = {
  id: string; showId: string; season: number; episode: number;
  author: string; titleBase: string; preview: string; body: string; updatedAt: number;
  likes: number;
  isPrivate?: boolean;
  isDeleted?: boolean;
  isEdited?: boolean;
  isRewatch?: boolean;
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
