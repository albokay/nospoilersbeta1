-- ============================================================
-- Align feedback RLS with the is_admin() helper
-- 2026-04-17
-- ============================================================
-- The feedback admin policies were originally written with a
-- hardcoded UUID (b4b37a6c-1f14-4189-9347-6ddbcadb99a6). The rest
-- of the system was later migrated to a public.is_admin() helper
-- that reads profiles.is_admin. The feedback table was missed,
-- so the admin panel can't read feedback unless you happen to be
-- logged in as that exact literal UUID.
--
-- This migration brings feedback in line so any profile flagged
-- is_admin = true (via the same mechanism used for every other
-- admin-gated table) can read, update, and delete feedback.
--
-- The INSERT policy ("users insert own feedback") is unchanged —
-- still gated by auth.uid() = user_id so users can only submit
-- feedback as themselves.
--
-- Apply manually in the Supabase SQL editor.
-- ============================================================

drop policy if exists "admin read all feedback"   on public.feedback;
drop policy if exists "admin update feedback"     on public.feedback;
drop policy if exists "admin delete feedback"     on public.feedback;

create policy "admin read all feedback" on public.feedback
  for select to authenticated
  using (public.is_admin());

create policy "admin update feedback" on public.feedback
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin delete feedback" on public.feedback
  for delete to authenticated
  using (public.is_admin());
