-- ============================================================
-- 2026-08-14 — Security hardening CP4 (LOW / defense-in-depth): pin
-- search_path on is_admin(), the function every admin RLS policy trusts.
-- It was the one security-critical SECURITY DEFINER function without a
-- pinned search_path (audit finding 13). Config-only ALTER — the body is
-- untouched, and it already schema-qualifies everything it references
-- (public.profiles, auth.uid()), so constraining the path cannot change
-- behavior. Zero risk.
-- ============================================================

ALTER FUNCTION public.is_admin() SET search_path = public;

-- Verify: proconfig should now list search_path=public.
--   SELECT proname, proconfig FROM pg_proc WHERE proname = 'is_admin';
