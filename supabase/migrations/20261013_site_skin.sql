-- ============================================================================
-- 2026-10-13 — The site-wide look (Alborz: "can the toggle apply the switch
-- for everyone?"). Applied by Alborz in the SQL editor.
--
-- One setting every account follows unless its own row says otherwise:
--   site_settings.default_skin = 'classic' | 'editorial'  (public-read, so
--   the signed-out pages — the homepage, an invitee's landing — follow it).
--   The admin flips it from the account card's "Everyone's look" row
--   (admin_set_site_skin, SECURITY DEFINER, gated on public.is_admin()).
--
-- profiles.skin becomes tri-state: NULL = follows the site (every account
-- today — 'classic' was the column's default, never a choice), 'classic' or
-- 'editorial' = this account's own pick (the admin's, for comparing; the
-- admin page can still pin any account). The Look row on the account card
-- is admin-only from here on, so flipping the site flips everyone at once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.site_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_settings_read_all ON public.site_settings;
CREATE POLICY site_settings_read_all
  ON public.site_settings FOR SELECT
  TO anon, authenticated
  USING (true);
GRANT SELECT ON public.site_settings TO anon, authenticated;

INSERT INTO public.site_settings (key, value) VALUES ('default_skin', 'classic')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_set_site_skin(p_skin text)
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
  INSERT INTO public.site_settings (key, value, updated_at)
  VALUES ('default_skin', p_skin, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_site_skin(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_site_skin(text) TO authenticated;

-- Accounts follow the site unless they chose. The CHECK (classic/editorial)
-- stays; NULL passes it.
ALTER TABLE public.profiles ALTER COLUMN skin DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN skin DROP DEFAULT;
UPDATE public.profiles SET skin = NULL WHERE skin = 'classic';
