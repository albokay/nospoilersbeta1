-- ============================================================
-- 2026-08-14 — Security hardening CP1: the two CRITICAL audit findings.
-- Paste-ready; Claude drafted, Alborz applies (prod-SQL split). Verified
-- read-only against prod before writing (see the audit): under the new
-- read rules a real non-admin user drops from seeing 103 threads / 616
-- replies (the entire corpus) to only their own + their rooms' rows.
--
-- Idempotent: safe to re-run. Only SELECT policies + UPDATE column grants
-- change — no data touched, no INSERT/UPDATE/DELETE policy touched.
-- ============================================================

-- ── Finding 1 (CRITICAL): self-granted admin ────────────────────────────────
-- profiles_update is USING (auth.uid() = id) with NO column restriction, and
-- is_admin lives on that row → any user could PATCH their own is_admin=true.
-- Fix (the same technique already used on the shows catalog,
-- 20260630_lock_shows_catalog_columns.sql): strip table-wide UPDATE and
-- re-grant ONLY the columns the client legitimately writes. is_admin,
-- is_seed, id, created_at are deliberately excluded — no client path writes
-- them (verified: the app updates only display_name / onboarded_at /
-- tsp_demo_seen_at / social_onboarded_at; username + bio granted too as
-- harmless non-privilege fields for future use). The row-level policy is
-- unchanged; column grants + RLS both still apply.
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT  UPDATE (username, display_name, bio, onboarded_at, tsp_demo_seen_at, social_onboarded_at)
       ON public.profiles TO authenticated;
-- (service_role / postgres keep full UPDATE — edge functions + anonymize.)

-- ── Finding 2 (CRITICAL): every private entry/reply readable by any account ──
-- threads_select / replies_select were TO authenticated USING (true) — the
-- spoiler + room-privacy model was enforced only in the React client. Scope
-- reads to: own, public, or in-a-room-you-belong-to. auth_is_group_member()
-- is SECURITY DEFINER (reads membership without re-triggering RLS → no
-- recursion). Room links live in group_threads (threads have no group_id);
-- replies carry group_id directly. Deleted rows stay readable to owners/
-- members on purpose (the room renders "[deleted]" tombstones). Above-
-- progress rows also stay readable to members — the app needs them for the
-- gated "X has written…" stubs; INTRA-room spoiler gating remains a
-- client concern (unchanged, smaller, separate from this finding). The
-- anon SELECT policies (threads_select_anon / replies_select_anon) are
-- already correctly scoped to public and are left untouched.

DROP POLICY IF EXISTS threads_select ON public.threads;
CREATE POLICY threads_select ON public.threads
  FOR SELECT TO authenticated
  USING (
    author_id = auth.uid()
    OR is_public = true
    OR EXISTS (
      SELECT 1 FROM public.group_threads gt
      WHERE gt.thread_id = threads.id
        AND public.auth_is_group_member(gt.group_id)
    )
  );

DROP POLICY IF EXISTS replies_select ON public.replies;
CREATE POLICY replies_select ON public.replies
  FOR SELECT TO authenticated
  USING (
    author_id = auth.uid()
    OR (group_id IS NOT NULL AND public.auth_is_group_member(group_id))
    OR (group_id IS NULL AND EXISTS (
      SELECT 1 FROM public.threads t
      WHERE t.id = replies.thread_id AND t.is_public = true
    ))
  );

-- ── Verify after applying ────────────────────────────────────────────────────
-- Expect: profiles UPDATE grant lists only the 6 safe columns; is_admin absent.
--   SELECT string_agg(column_name, ', ' ORDER BY column_name)
--   FROM information_schema.column_privileges
--   WHERE table_name='profiles' AND grantee='authenticated' AND privilege_type='UPDATE';
-- Expect: both policies show the new USING expr, not "true".
--   SELECT polname, pg_get_expr(polqual, polrelid)
--   FROM pg_policy WHERE polname IN ('threads_select','replies_select');
