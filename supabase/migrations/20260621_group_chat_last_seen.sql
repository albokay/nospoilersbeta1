-- ============================================================
-- Group chat — per-member last-seen + new-message activity
-- ============================================================
-- ADDITIVE, idempotent. Backs the chat notification dot (chat button + the
-- dashboard cluster rollup). Mirrors the room last_seen shape but on the
-- people-group membership row.
--
--   • people_group_members.chat_last_seen_at — stamped when the user opens chat.
--   • mark_group_chat_seen(group_id) — stamp the caller's own row.
--   • get_group_chat_activity(user) — per group: chat_last_seen_at + the newest
--     OTHER member's message time (own messages excluded). Client shows a dot
--     when latest_message_at > chat_last_seen_at (or never-seen + has messages).
-- All SECURITY DEFINER (people_group_members RLS has no UPDATE policy and the
-- helper bypasses the recursion-prone member RLS).
-- ============================================================

ALTER TABLE public.people_group_members
  ADD COLUMN IF NOT EXISTS chat_last_seen_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.mark_group_chat_seen(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.people_group_members
  SET chat_last_seen_at = now()
  WHERE group_id = p_group_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_group_chat_activity(p_user_id UUID DEFAULT auth.uid())
RETURNS TABLE (
  group_id UUID,
  chat_last_seen_at TIMESTAMPTZ,
  latest_message_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    m.group_id,
    m.chat_last_seen_at,
    (SELECT MAX(gm.created_at)
       FROM public.group_messages gm
      WHERE gm.group_id = m.group_id
        AND gm.author_id <> p_user_id) AS latest_message_at
  FROM public.people_group_members m
  WHERE m.user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_group_chat_seen(UUID)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_group_chat_seen(UUID)   TO authenticated;
REVOKE ALL ON FUNCTION public.get_group_chat_activity(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_group_chat_activity(UUID) TO authenticated;
