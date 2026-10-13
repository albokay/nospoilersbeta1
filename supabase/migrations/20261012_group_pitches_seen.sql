-- ============================================================
-- 2026-10-12 — A friend's NEW PITCH is signalled (Alborz's notes, round 3)
-- ============================================================
-- ADDITIVE, idempotent. Mirrors the chat seen-stamp shape
-- (20260621_group_chat_last_seen.sql) on the people-group membership row.
--
--   • people_group_members.pitches_last_seen_at — stamped when the member
--     opens the group room (the client stamps after it has drawn the marks).
--   • mark_group_pitches_seen(group_id) — stamp the caller's own row.
--   • get_group_pitch_activity(user) — per group the caller is in: the stamp,
--     the newest PITCH by someone else (a pitch = the EARLIEST vote on a show
--     in the group; a later yes is an answer, not a pitch), with the show's
--     name and the pitcher's id, and how many pitches are newer than the stamp.
--     The client shows the dashboard line / note and the room's marks when
--     latest_pitch_at > pitches_last_seen_at (or never seen + any pitch).
-- SECURITY DEFINER like the chat pair (the membership RLS has no UPDATE
-- policy and the helper bypasses the recursion-prone member RLS).
-- The frontend is tolerant before this runs: a missing RPC means no marks.
-- ============================================================

BEGIN;

ALTER TABLE public.people_group_members
  ADD COLUMN IF NOT EXISTS pitches_last_seen_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.mark_group_pitches_seen(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.people_group_members
  SET pitches_last_seen_at = now()
  WHERE group_id = p_group_id AND user_id = auth.uid();
END;
$$;

DROP FUNCTION IF EXISTS public.get_group_pitch_activity(UUID);

CREATE FUNCTION public.get_group_pitch_activity(p_user_id UUID DEFAULT auth.uid())
RETURNS TABLE (
  group_id UUID,
  pitches_last_seen_at TIMESTAMPTZ,
  latest_pitch_at TIMESTAMPTZ,
  latest_pitch_show_id TEXT,
  latest_pitch_show_name TEXT,
  latest_pitch_user_id UUID,
  new_count INTEGER
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
    m.pitches_last_seen_at,
    p.lp_at,
    p.lp_show,
    s.name,
    p.lp_user,
    p.lp_new
  FROM public.people_group_members m
  LEFT JOIN LATERAL (
    SELECT
      MAX(f.created_at) AS lp_at,
      (ARRAY_AGG(f.show_id ORDER BY f.created_at DESC))[1] AS lp_show,
      (ARRAY_AGG(f.user_id ORDER BY f.created_at DESC))[1] AS lp_user,
      (COUNT(*) FILTER (WHERE f.created_at > COALESCE(m.pitches_last_seen_at, '-infinity'::timestamptz)))::INTEGER AS lp_new
    FROM (
      SELECT DISTINCT ON (v.show_id) v.show_id, v.user_id, v.created_at
      FROM public.group_show_votes v
      WHERE v.group_id = m.group_id
      ORDER BY v.show_id, v.created_at ASC
    ) f
    WHERE f.user_id <> p_user_id
  ) p ON TRUE
  LEFT JOIN public.shows s ON s.id::text = p.lp_show
  WHERE m.user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_group_pitches_seen(UUID)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_group_pitches_seen(UUID)   TO authenticated;
REVOKE ALL ON FUNCTION public.get_group_pitch_activity(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_group_pitch_activity(UUID) TO authenticated;

COMMIT;

-- Verification (run after, as yourself): one row per group you're in;
-- latest_pitch_* = the newest show a friend pitched, new_count > 0 until you
-- open that group room.
-- SELECT * FROM public.get_group_pitch_activity();
