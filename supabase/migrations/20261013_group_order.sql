-- ============================================================
-- Your own order of your groups (Alborz's notes, round 5 — 2026-10-13)
-- ============================================================
-- The dashboard's group rows drag into an order of your own (the grip at
-- the row's end). The order is PERSONAL — it rides on your membership row,
-- never on the group — so every member orders their own dashboard.
--
--   people_group_members.sort_order  integer, null until you first drag;
--                                     the dashboard reads it with the
--                                     membership (column-tolerant).
--   set_group_order(p_group_ids)      saves the dragged order for the caller:
--                                     sort_order = the id's position in the
--                                     array (1-based). Only the caller's own
--                                     rows; ids they aren't a member of are
--                                     ignored. SECURITY DEFINER like
--                                     mark_group_pitches_seen.
-- ============================================================

ALTER TABLE public.people_group_members
  ADD COLUMN IF NOT EXISTS sort_order integer;

CREATE OR REPLACE FUNCTION public.set_group_order(p_group_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  UPDATE public.people_group_members m
     SET sort_order = o.ord
    FROM unnest(p_group_ids) WITH ORDINALITY AS o(gid, ord)
   WHERE m.user_id = v_caller AND m.group_id = o.gid;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_group_order(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_order(UUID[]) TO authenticated;
