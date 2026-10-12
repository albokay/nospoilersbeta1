-- ============================================================================
-- 2026-10-10 — The editorial skin's per-account switch (checkpoint 1 of
-- docs/editorial-skin-plan.md). Applied by Alborz in the SQL editor.
--
-- profiles.skin decides which look an account sees: 'classic' (the live site
-- as it is — the default for every existing and new account) or 'editorial'
-- (the round-3 design, built page by page behind this switch). The app reads
-- it with the profile and tolerates its absence (classic) until this runs.
--
-- Writes: a user may set their OWN row (the account card's Look section;
-- profiles UPDATE is column-locked, so the new column needs its grant), and
-- an admin flips any account through admin_set_profile_skin (SECURITY
-- DEFINER, gated on public.is_admin(), like admin_set_show_hidden).
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS skin text NOT NULL DEFAULT 'classic'
  CHECK (skin IN ('classic', 'editorial'));

GRANT UPDATE (skin) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_profile_skin(p_user_id uuid, p_skin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_skin NOT IN ('classic', 'editorial') THEN
    RAISE EXCEPTION 'bad_skin';
  END IF;
  UPDATE public.profiles SET skin = p_skin WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_profile_skin(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_skin(uuid, text) TO authenticated;

-- Alborz's own account sees the editorial skin from here on (the one admin
-- account); every other account stays classic until it is flipped on the
-- admin page. To go back: SET skin = 'classic'.
UPDATE public.profiles SET skin = 'editorial' WHERE is_admin;
