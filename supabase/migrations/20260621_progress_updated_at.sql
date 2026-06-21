-- ============================================================
-- progress.updated_at — track when a progress row last changed
-- ============================================================
-- ADDITIVE, idempotent. The `progress` table had no timestamp column, so
-- ordering shows by "most recently updated progress" (dashboard) and the
-- group dashboard's per-show last_activity_at both need this.
--
-- New rows default to now(); a BEFORE UPDATE trigger bumps it on every change
-- (the app's progress upserts go through INSERT ... ON CONFLICT DO UPDATE, so
-- the trigger fires on the update path). Existing rows are backfilled to now()
-- by the column DEFAULT.
--
-- NOTE: get_group_dashboard (20260621_restructure_group_dashboard_activity.sql)
-- already references progress.updated_at; PL/pgSQL defers column resolution to
-- run time, so that function only works once THIS column exists. Apply this.
-- ============================================================

ALTER TABLE public.progress
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_progress_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS progress_set_updated_at ON public.progress;
CREATE TRIGGER progress_set_updated_at
  BEFORE UPDATE ON public.progress
  FOR EACH ROW
  EXECUTE FUNCTION public.set_progress_updated_at();
