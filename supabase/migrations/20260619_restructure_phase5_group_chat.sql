-- ============================================================
-- Restructure Phase 5 — group chat (§12)
-- ============================================================
-- Per-people-group persistent chat. NOT real-time for v1 — the client fetches
-- on open + after send (like entries). NOT spoiler-gated. ADDITIVE, idempotent.
--
-- One table + member-gated RLS (reuses the is_member_of_people_group helper
-- from phase1b, which bypasses RLS internally so there's no policy recursion).
-- Writes go direct with a WITH CHECK (author is the caller + a member).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.group_messages (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID         NOT NULL REFERENCES public.people_groups(id) ON DELETE CASCADE,
  author_id   UUID         NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  body        TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_messages_group_idx
  ON public.group_messages (group_id, created_at);

ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_messages_select_member ON public.group_messages;
CREATE POLICY group_messages_select_member
  ON public.group_messages
  FOR SELECT
  USING (public.is_member_of_people_group(group_id));

DROP POLICY IF EXISTS group_messages_insert_member ON public.group_messages;
CREATE POLICY group_messages_insert_member
  ON public.group_messages
  FOR INSERT
  WITH CHECK (author_id = auth.uid() AND public.is_member_of_people_group(group_id));
