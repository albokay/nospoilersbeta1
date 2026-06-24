-- ============================================================
-- Restructure CP8a — BTU migration-dormancy flag (additive, non-destructive).
-- ============================================================
-- Prep for the CP8 cutover. The one surviving group ("Beyond the Underdome")
-- is seeded into a removed-from-pool state, so on first login its pool is
-- empty. The product has NO empty-pool rule (a group you're in always stays in
-- your rail so its chat survives), and empty pools can't arise organically — so
-- the empty BTU pool is an anomaly we hide with an explicit, self-erasing flag
-- (spec §15.4), NOT through any emptiness check.
--
--   • people_group_members.migration_dormant — when true, the group is hidden
--     from THAT member's rail.
--   • clear_migration_dormant_for_show(show) — clears the caller's flag for any
--     group that has a (parented) room for that show. Called when the user
--     re-adds Paradise, after which BTU behaves like any normal group.
--
-- This migration is ADDITIVE and idempotent. It sets NO flags — the CP8b
-- cutover migration is what marks the five BTU memberships dormant. Until then
-- the column is false everywhere and nothing changes.
-- ============================================================

ALTER TABLE public.people_group_members
  ADD COLUMN IF NOT EXISTS migration_dormant BOOLEAN NOT NULL DEFAULT false;

-- Clear the caller's dormancy flag for any group that owns a room for p_show_id
-- (a parented friend_groups row). Re-adding Paradise un-hides Beyond the
-- Underdome. SECURITY DEFINER so the caller can flip only their OWN membership
-- rows (scoped to auth.uid()), without a broad UPDATE policy on the table.
CREATE OR REPLACE FUNCTION public.clear_migration_dormant_for_show(p_show_id TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.people_group_members m
  SET migration_dormant = false
  WHERE m.user_id = auth.uid()
    AND m.migration_dormant = true
    AND EXISTS (
      SELECT 1
      FROM public.friend_groups fg
      WHERE fg.parent_group_id = m.group_id
        AND fg.show_id = p_show_id
        AND fg.deleted_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.clear_migration_dormant_for_show(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.clear_migration_dormant_for_show(TEXT) TO authenticated;
