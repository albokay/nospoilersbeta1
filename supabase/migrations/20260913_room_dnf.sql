-- ============================================================
-- Room DNF — "we're done with this one" (Alborz 2026-09-13)
-- ============================================================
-- A group can park a show it doesn't want to finish: any CURRENT ROOM
-- MEMBER can set/clear the marker (friend_groups UPDATE is creator-only
-- under RLS, so the write goes through a member-gated RPC). A parked room
-- leaves the group's shelves and piles up in the finished drawer under
-- "Didn't finish:"; reviving clears the marker and the button returns.
-- Additive: two nullable columns + one RPC.
-- ============================================================

BEGIN;

ALTER TABLE public.friend_groups
  ADD COLUMN IF NOT EXISTS dnf_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dnf_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.set_room_dnf(p_room_id UUID, p_dnf BOOLEAN)
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
  -- Member-gated: only a current member of THIS room (a restructure show
  -- room, i.e. it has a parent people-group) can park or revive it.
  IF NOT EXISTS (
    SELECT 1
    FROM friend_group_members m
    JOIN friend_groups fg ON fg.id = m.group_id
    WHERE m.group_id = p_room_id
      AND m.user_id = v_caller
      AND fg.deleted_at IS NULL
      AND fg.parent_group_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_member');
  END IF;

  UPDATE friend_groups
  SET dnf_at = CASE WHEN p_dnf THEN NOW() ELSE NULL END,
      dnf_by = CASE WHEN p_dnf THEN v_caller ELSE NULL END
  WHERE id = p_room_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_room_dnf(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_room_dnf(UUID, BOOLEAN) TO authenticated;

COMMIT;
