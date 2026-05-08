-- ============================================================
-- Round 2, Phase 2e — lazy close on duration expiry
-- ============================================================
-- Adds lazy_close_room_polls RPC. Frontend calls this on mount of
-- the room view; any open polls past their duration get stamped
-- closed. The RETURNING clause + the `closed_at IS NULL` guard make
-- this race-safe — among parallel callers, exactly one wins for each
-- expired poll, so the close email fires once.
--
-- Returns: UUID[] of polls this call closed (typically 0 entries;
-- 1+ when the caller is the first member to enter after expiry).
-- ============================================================

CREATE OR REPLACE FUNCTION public.lazy_close_room_polls(p_group_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_closed UUID[];
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN ARRAY[]::UUID[];
  END IF;

  -- Caller must be a current member of the group.
  IF NOT EXISTS (
    SELECT 1 FROM public.friend_group_members
    WHERE group_id = p_group_id AND user_id = v_caller
  ) THEN
    RETURN ARRAY[]::UUID[];
  END IF;

  WITH closed_now AS (
    UPDATE public.polls
       SET closed_at = now()
     WHERE group_id  = p_group_id
       AND closed_at IS NULL
       AND now() > created_at + (
         CASE duration
           WHEN '24h' THEN interval '24 hours'
           WHEN '3d'  THEN interval '3 days'
           WHEN '1w'  THEN interval '7 days'
         END
       )
    RETURNING id
  )
  SELECT array_agg(id) INTO v_closed FROM closed_now;

  RETURN COALESCE(v_closed, ARRAY[]::UUID[]);
END;
$$;

REVOKE ALL ON FUNCTION public.lazy_close_room_polls(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lazy_close_room_polls(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.lazy_close_room_polls(UUID) TO authenticated;
