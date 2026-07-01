-- ============================================================================
-- 2026-06-30 — Lock the shared shows catalog against non-admin vandalism.
--
-- shows_update RLS was USING (true), so any authenticated user could update
-- ANY column of ANY show (rename it, swap its image, hide it) via a direct API
-- call — and the catalog is shared, so a change hits everyone. The only
-- legitimate regular-user writes are the episode-refresh columns
-- (refreshShowIfStale: seasons/last_synced_at/genres/tvmaze_type/status).
--
-- Fix: restrict authenticated UPDATE to exactly those columns via column-level
-- privileges. name / image / is_hidden / id can no longer be changed by a
-- regular client. The row-level RLS policy (shows_update USING true) is left as
-- is; INSERT (adding a show from search) and admin DELETE are unaffected.
--
-- The admin "hide show" toggle intentionally loses direct is_hidden UPDATE, so
-- it now goes through admin_set_show_hidden() (SECURITY DEFINER, is_admin()).
-- ============================================================================

REVOKE UPDATE ON public.shows FROM authenticated;
GRANT UPDATE (seasons, last_synced_at, genres, tvmaze_type, status)
  ON public.shows TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_show_hidden(p_show_id text, p_hidden boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE public.shows SET is_hidden = p_hidden WHERE id = p_show_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_show_hidden(text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_show_hidden(text, boolean) TO authenticated;
