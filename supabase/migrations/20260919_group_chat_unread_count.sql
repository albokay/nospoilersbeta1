-- ============================================================
-- 2026-09-19 — Chat tab shows the UNREAD MESSAGE COUNT
-- (odds-and-ends item 1, Alborz: the number lives ONLY on the chat tab's
-- own notification; the dashboard/cluster dots stay dots because they
-- roll up other kinds of new writing too).
--
-- Replaces get_group_chat_activity from 20260621_group_chat_last_seen.sql
-- with ONE added output column: unread_count = other members' messages
-- newer than the caller's chat_last_seen_at (all of them when never seen).
-- The return shape changes, so this is DROP + CREATE (OR REPLACE refuses a
-- new column). Existing columns, grants and the p_user_id guard: unchanged.
-- mark_group_chat_seen is untouched.
--
-- Frontend is tolerant before this runs: a missing unread_count renders
-- the plain dot exactly as today.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_group_chat_activity(UUID);

CREATE FUNCTION public.get_group_chat_activity(p_user_id UUID DEFAULT auth.uid())
RETURNS TABLE (
  group_id UUID,
  chat_last_seen_at TIMESTAMPTZ,
  latest_message_at TIMESTAMPTZ,
  unread_count INTEGER
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
        AND gm.author_id <> p_user_id) AS latest_message_at,
    (SELECT COUNT(*)::INTEGER
       FROM public.group_messages gm
      WHERE gm.group_id = m.group_id
        AND gm.author_id <> p_user_id
        AND gm.created_at > COALESCE(m.chat_last_seen_at, '-infinity'::timestamptz)) AS unread_count
  FROM public.people_group_members m
  WHERE m.user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_chat_activity(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_group_chat_activity(UUID) TO authenticated;

COMMIT;

-- Verification (run after, as yourself): one row per group you're in;
-- unread_count = 0 for chats you've opened since the last message, > 0 for
-- any with friends' messages newer than your last open.
-- SELECT * FROM public.get_group_chat_activity();
