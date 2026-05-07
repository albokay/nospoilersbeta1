-- ── SIKW: shorten auto-close window from 7 days → 3 days ─────────────────
-- Replaces lazy_close_room_asks defined in
-- 20260506_sikw_phase_3a_schema_and_rls.sql:525.
-- Function shape, signature, and security model are unchanged; only the
-- duration constant in the WHERE clause flips.

CREATE OR REPLACE FUNCTION public.lazy_close_room_asks(p_group_id UUID)
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

  IF NOT EXISTS (
    SELECT 1 FROM public.friend_group_members
    WHERE group_id = p_group_id AND user_id = v_caller
  ) THEN
    RETURN ARRAY[]::UUID[];
  END IF;

  WITH closed_now AS (
    UPDATE public.sikw_asks
       SET closed_at = now()
     WHERE group_id  = p_group_id
       AND closed_at IS NULL
       AND now() > created_at + interval '3 days'
    RETURNING id
  )
  SELECT array_agg(id) INTO v_closed FROM closed_now;

  RETURN COALESCE(v_closed, ARRAY[]::UUID[]);
END;
$$;
