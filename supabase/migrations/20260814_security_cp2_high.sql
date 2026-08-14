-- ============================================================
-- 2026-08-14 — Security hardening CP2: the three HIGH audit findings.
-- Paste-ready; Claude drafted, Alborz applies. Verified read-only against
-- prod: the client never writes friend_group_members directly and never
-- calls either function; every legitimate member-write goes through a
-- SECURITY DEFINER RPC (accept_invitation, accept_people_group_invitation,
-- start_show_room — all confirmed definer), and the digest runner is driven
-- only by pg_cron (jobs friend-room-digest-a/b). So none of these touch a
-- live app path.
--
-- Idempotent; only a policy drop + two function REVOKEs. No data touched.
-- ============================================================

-- ── Finding 3 (HIGH): anyone can insert themselves into any room ────────────
-- friend_group_members INSERT policy was WITH CHECK (auth.role() =
-- 'authenticated') — any logged-in user could add any user_id to any room
-- uuid (room ids travel in email links). All real joins go through the
-- definer RPCs above (which bypass RLS), so removing this policy leaves
-- RPC-only writes — the same model people_group_members already uses
-- (no write policy at all). SELECT (member-only) and DELETE (self-leave /
-- creator-remove) policies are correct and untouched.
DROP POLICY IF EXISTS "group creator can add members" ON public.friend_group_members;

-- ── Finding 4 (HIGH): unauthenticated provisioning ──────────────────────────
-- provision_sidebar_protocol(uuid) is SECURITY DEFINER, does NO auth.uid()
-- check, and is anon-executable (default PUBLIC) — a logged-out attacker
-- could loop it with arbitrary user ids to inject rooms/seeded content and
-- balloon storage. It is presently DORMANT (no trigger attached anywhere,
-- no client caller — verified), so this is a pure lock-down. If it is ever
-- re-wired, invoke it from a trigger (runs as owner, unaffected by this) or
-- add a caller-auth gate; never expose it to anon/authenticated directly.
REVOKE ALL ON FUNCTION public.provision_sidebar_protocol(uuid) FROM PUBLIC, anon, authenticated;

-- ── Finding 7 (HIGH/MED): anyone can trigger digest email blasts ────────────
-- run_friend_room_digest() reads a Vault secret and POSTs to send-digests.
-- It self-checks the hour window + secret, but is PUBLIC-executable, so
-- during the daily send window any caller (even logged-out) could fire it.
-- pg_cron runs jobs as their owner, so cron is UNAFFECTED by this revoke.
REVOKE ALL ON FUNCTION public.run_friend_room_digest() FROM PUBLIC, anon, authenticated;

-- ── Verify after applying ────────────────────────────────────────────────────
-- friend_group_members should have NO INSERT ('a') policy left:
--   SELECT polname, polcmd FROM pg_policy
--   WHERE polrelid='public.friend_group_members'::regclass;
-- Neither function should list anon/authenticated as an executor:
--   SELECT p.proname, has_function_privilege('anon', p.oid,'execute') AS anon_can,
--          has_function_privilege('authenticated', p.oid,'execute') AS auth_can
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public'
--     AND p.proname IN ('provision_sidebar_protocol','run_friend_room_digest');
