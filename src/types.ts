export type Thread = {
  id: string; showId: string; season: number; episode: number;
  author: string; titleBase: string; preview: string; body: string; updatedAt: number;
  likes: number;
  isPrivate?: boolean;
  isDeleted?: boolean;
  isEdited?: boolean;
};

export type Reply = {
  id: string; threadId: string; showId: string; season: number; episode: number;
  author: string; body: string; updatedAt: number; replyToId?: string;
  likes: number;
  isDeleted?: boolean;
  isEdited?: boolean;
};
