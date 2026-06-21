-- ============================================================
-- Restructure Phase 6 — remove-a-show-from-your-pool (§4)
-- ============================================================
-- Adds progress.in_pool (default true, so every existing show stays in-pool)
-- and a cascade RPC. ADDITIVE, idempotent. The live app's fetchProgress does
-- not select in_pool, so this column is invisible to it.
--
-- Remove-from-pool is GLOBAL (distinct from the per-group un-vote): keep the
-- user's progress but mark it out of pool, down-vote the show in every group,
-- and leave every (group × show) restructure room for that show — leaving a
-- termination dot where they had map history (progress/ratings). Friend-room
-- entries and private writing are untouched. Re-adding (search) flips in_pool
-- back to true and the saved progress is restored.
-- ============================================================

ALTER TABLE public.progress
  ADD COLUMN IF NOT EXISTS in_pool BOOLEAN NOT NULL DEFAULT true;


CREATE OR REPLACE FUNCTION public.remove_show_from_pool(p_show_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_username TEXT;
  r          RECORD;
  v_history  BOOLEAN;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  IF p_show_id IS NULL OR length(trim(p_show_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'show_required');
  END IF;

  SELECT username INTO v_username FROM public.profiles WHERE id = v_caller;

  -- Keep progress; just take the show out of the pool.
  UPDATE public.progress SET in_pool = false WHERE user_id = v_caller AND show_id = p_show_id;

  -- Down-vote the show in every group.
  DELETE FROM public.group_show_votes WHERE user_id = v_caller AND show_id = p_show_id;

  -- Leave every (group × show) restructure room for this show.
  FOR r IN
    SELECT fg.id, fg.show_id
    FROM public.friend_groups fg
    WHERE fg.show_id = p_show_id
      AND fg.parent_group_id IS NOT NULL
      AND fg.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.friend_group_members m WHERE m.group_id = fg.id AND m.user_id = v_caller)
  LOOP
    v_history :=
      EXISTS (SELECT 1 FROM public.progress WHERE user_id = v_caller AND show_id = r.show_id AND (season > 0 OR episode > 0))
      OR EXISTS (SELECT 1 FROM public.episode_ratings WHERE user_id = v_caller AND show_id = r.show_id);

    IF v_history AND NOT EXISTS (
      SELECT 1 FROM public.friend_group_departed_members WHERE group_id = r.id AND user_id = v_caller
    ) THEN
      INSERT INTO public.friend_group_departed_members (group_id, user_id, username, departed_at)
      VALUES (r.id, v_caller, COALESCE(v_username, '?'), now());
    END IF;

    DELETE FROM public.friend_group_members WHERE group_id = r.id AND user_id = v_caller;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_show_from_pool(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.remove_show_from_pool(TEXT) TO authenticated;
