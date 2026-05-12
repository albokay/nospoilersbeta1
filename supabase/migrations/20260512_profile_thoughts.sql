-- 2026-05-12 — Profile "Thoughts on..." pieces (checkpoint 1)
--
-- A new writing form that lives entirely on the V2 public profile. Not tied
-- to shows, not part of journals, friend rooms, or the public space. Each
-- piece has a locked opener ("Thoughts on ") + a user-written completion +
-- a body. State is two-valued: private (owner-only) or public (visible to
-- visitors). The UI prevents public → private transitions; once published,
-- a piece can be edited (stays public) or deleted, not unpublished.
--
-- Replaces the inline `profiles.bio` field at the top of the profile. The
-- bio column itself is preserved (dormant) to retain any user data already
-- written; a later migration may drop it once we're certain nothing reads
-- it anymore.
--
-- Schema notes:
--   - `last_published_at` is set on the private→public transition (and on
--     fresh public inserts), and never on a public→public edit. Owner view
--     uses it to identify the "featured" (most recently published) piece.
--   - Length checks are CHECK constraints rather than VARCHAR caps so the
--     UI's soft-cap behavior (counter, no hard block until ~150) maps to
--     SQL cleanly.
--
-- RLS:
--   - SELECT: visible if is_public=true OR caller owns the row. Visitors
--     (including unauthenticated) see only published pieces.
--   - INSERT/UPDATE/DELETE: caller must be the row owner.

CREATE TABLE IF NOT EXISTS public.profile_thoughts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title_completion text NOT NULL CHECK (
    length(title_completion) > 0 AND length(title_completion) <= 200
  ),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_published_at timestamptz NULL
);

-- Index for visitor view: per-author, public only, ordered by published-at.
CREATE INDEX IF NOT EXISTS idx_profile_thoughts_public_by_author
  ON public.profile_thoughts (author_id, last_published_at DESC)
  WHERE is_public = true;

-- Index for owner view: per-author, ordered by created-at.
CREATE INDEX IF NOT EXISTS idx_profile_thoughts_by_author_created
  ON public.profile_thoughts (author_id, created_at DESC);

-- updated_at trigger. SET search_path = public per the post-2026-04-23
-- Supabase-advisor convention (HANDOFF §6 item 21): all new SECURITY DEFINER
-- and trigger functions explicitly pin search_path so no schema-shadowing
-- attack vector exists, even theoretically.
CREATE OR REPLACE FUNCTION public.touch_profile_thoughts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profile_thoughts_touch_updated_at ON public.profile_thoughts;
CREATE TRIGGER trg_profile_thoughts_touch_updated_at
  BEFORE UPDATE ON public.profile_thoughts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_profile_thoughts_updated_at();

-- RLS
ALTER TABLE public.profile_thoughts ENABLE ROW LEVEL SECURITY;

-- Drop-and-recreate so re-running the migration converges cleanly.
DROP POLICY IF EXISTS profile_thoughts_select ON public.profile_thoughts;
DROP POLICY IF EXISTS profile_thoughts_insert ON public.profile_thoughts;
DROP POLICY IF EXISTS profile_thoughts_update ON public.profile_thoughts;
DROP POLICY IF EXISTS profile_thoughts_delete ON public.profile_thoughts;

CREATE POLICY profile_thoughts_select
  ON public.profile_thoughts
  FOR SELECT
  TO authenticated, anon
  USING (is_public = true OR author_id = auth.uid());

CREATE POLICY profile_thoughts_insert
  ON public.profile_thoughts
  FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

CREATE POLICY profile_thoughts_update
  ON public.profile_thoughts
  FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY profile_thoughts_delete
  ON public.profile_thoughts
  FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());
