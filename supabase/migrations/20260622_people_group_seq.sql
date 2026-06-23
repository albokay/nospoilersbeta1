-- ============================================================
-- Restructure — people_groups.seq (stable per-creator group number)
-- ============================================================
-- ADDITIVE, idempotent. Gives every people-group a permanent integer `seq`
-- assigned at creation = (max seq among that creator's groups) + 1. Used to
-- render an unnamed group as "Group <seq>" instead of deriving a name from
-- member handles. The number is FIXED: deleting an earlier group never
-- renumbers later ones (max+1 just skips the gap), so labels are stable.
-- All members of a group see the same number (the creator's).
-- ============================================================

ALTER TABLE public.people_groups
  ADD COLUMN IF NOT EXISTS seq INTEGER;

-- Backfill: number each creator's existing groups by creation order. Counts
-- soft-deleted groups too so live groups keep gap-free historical numbers and
-- new groups (max+1) never collide with a number a deleted group used.
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY created_by ORDER BY created_at, id) AS rn
    FROM public.people_groups
   WHERE seq IS NULL
)
UPDATE public.people_groups g
   SET seq = n.rn
  FROM numbered n
 WHERE g.id = n.id;


-- Re-create the group-creation RPC to stamp seq = max(seq for this creator)+1.
-- (Only the seq line is new vs the phase-1 definition.)
CREATE OR REPLACE FUNCTION public.create_people_group(p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller    UUID;
  v_group_id  UUID;
  v_name      TEXT;
  v_seq       INTEGER;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  v_name := NULLIF(trim(COALESCE(p_name, '')), '');
  IF v_name IS NOT NULL AND length(v_name) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name_too_long');
  END IF;

  -- Next stable number for this creator (counts soft-deleted groups so the
  -- number is never reused).
  SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.people_groups
   WHERE created_by = v_caller;

  INSERT INTO public.people_groups (name, created_by, seq)
  VALUES (v_name, v_caller, v_seq)
  RETURNING id INTO v_group_id;

  INSERT INTO public.people_group_members (group_id, user_id)
  VALUES (v_group_id, v_caller);

  RETURN jsonb_build_object('ok', true, 'group_id', v_group_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_people_group(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_people_group(TEXT) TO authenticated;
