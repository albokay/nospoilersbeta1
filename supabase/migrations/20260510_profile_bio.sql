-- Adds a bio column to the profiles table. Powers the inline-editable
-- bio field on V2ProfileSelfPage (replaces the prior static "add a
-- bio…" placeholder copy) and the same bio rendered on visitor view
-- of someone else's profile (V2ProfileVisitorPage).
--
-- RLS is unchanged: profiles_select is public (USING true), so visitors
-- can read bios. profiles_update is owner-only (USING auth.uid() = id),
-- so only the user can edit their own bio. See migration
-- 20260413_enable_rls_all_tables.sql lines 50-67 for the existing policy
-- shape — those policies already cover the new column.
--
-- IF NOT EXISTS so the migration is idempotent (safe to re-run).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;
