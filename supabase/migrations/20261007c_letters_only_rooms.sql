-- 2026-10-07 — The switch (letters-only rooms arc, checkpoint 4 of 4).
--
-- Every show room created from now on is LETTERS-ONLY: a stream of letters,
-- with highlight notes in place of responses. Rooms that already exist keep
-- responses exactly as they are — nothing is hidden or lost. The property
-- lives on the room from the day it starts and never changes by itself.
--
-- To try it on one group's rooms before this default was flipped, or to
-- turn responses back on for a room, set the flag by hand:
--   UPDATE public.friend_groups SET letters_only = false WHERE id = '<room id>';
--
-- The response insert rule refuses a response to a letters-only room, so a
-- stale open tab can't post one. Paste the whole file. Safe to re-run.

ALTER TABLE public.friend_groups
  ADD COLUMN IF NOT EXISTS letters_only BOOLEAN NOT NULL DEFAULT false;

-- Rooms that exist keep responses (false); every room created after this
-- line is letters-only.
ALTER TABLE public.friend_groups ALTER COLUMN letters_only SET DEFAULT true;

DROP POLICY IF EXISTS "replies_insert" ON public.replies;
CREATE POLICY "replies_insert"
  ON public.replies FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_id
    AND (
      (
        group_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.friend_groups fg
          WHERE fg.id = group_id AND fg.letters_only
        )
      )
      OR (
        group_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.threads t
          WHERE t.id = thread_id
            AND public.can_respond_to_public(t.author_id, auth.uid())
        )
      )
    )
  );
