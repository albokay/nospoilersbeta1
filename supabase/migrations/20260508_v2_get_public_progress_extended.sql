-- 2026-05-08 — v2 UI rethink, checkpoint 5 phase A.
--
-- Extends get_public_progress to return the v2 progress columns
-- (canon_pin + four shelf blurbs + rewatch + finished-detection
-- fields). The v2 visitor profile (`/v2/u/:username`) needs these
-- to classify and render the owner's shelves.
--
-- Privacy posture: a "public profile" is a user-chosen public
-- surface. Every column returned here is one the owner has
-- already chosen to expose to the world by being on Sidebar's
-- public profile model. Same SECURITY DEFINER + STABLE shape as
-- the original — read-only, no enumeration risk (caller must
-- already know the target's user UUID).
--
-- Why DROP + CREATE instead of CREATE OR REPLACE: Postgres rejects
-- CREATE OR REPLACE FUNCTION when the RETURNS TABLE shape changes
-- (error 42P13). DROP IF EXISTS + CREATE inside a single BEGIN/COMMIT
-- transaction makes the swap atomic — no concurrent caller can see
-- the function missing. The existing live caller
-- (`fetchPublicProgressForUser` at db.ts:1251) keys by column name
-- and ignores extras, so the new shape is non-breaking once applied.
--
-- search_path is intentionally NOT set here — matches the existing
-- function's settings to keep the diff minimal. The Supabase advisor
-- finding for "Function Search Path Mutable" (HANDOFF §6 item 21)
-- can be cleaned in its own dedicated pass alongside the eight other
-- functions on that list.

BEGIN;

DROP FUNCTION IF EXISTS public.get_public_progress(uuid);

CREATE FUNCTION public.get_public_progress(target_user_id uuid)
RETURNS TABLE (
  show_id          text,
  season           int,
  episode          int,
  is_rewatching    boolean,
  rewatch_season   int,
  rewatch_episode  int,
  highest_season   int,
  highest_episode  int,
  stopped_watching boolean,
  canon_pin        boolean,
  watching_quote   text,
  want_reason      text,
  canon_take       text,
  stopped_reason   text
)
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT
    p.show_id,
    p.season,
    p.episode,
    p.is_rewatching,
    p.rewatch_season,
    p.rewatch_episode,
    p.highest_season,
    p.highest_episode,
    p.stopped_watching,
    p.canon_pin,
    p.watching_quote,
    p.want_reason,
    p.canon_take,
    p.stopped_reason
  FROM public.progress p
  WHERE p.user_id = target_user_id;
$$;

COMMIT;
