-- ============================================================
-- SIKW: switch closed-state dismissal from per-viewer to global
-- ============================================================
-- Spec amendment: when ANYONE in the room dismisses a closed SIKW
-- ask, the closed-state sticky disappears for ALL members. Different
-- from polls, which stay per-viewer per spec.
--
-- Implementation: a `dismissed_at` column on sikw_asks itself.
-- dismiss_closed_ask now stamps that column (race-safe via
-- `dismissed_at IS NULL` guard); first dismiss wins.
--
-- Idempotent. Existing per-user rows in sikw_dismissals stay in
-- place but are no longer read — table left for now in case we
-- want to roll back. Safe to drop later.
-- ============================================================

ALTER TABLE public.sikw_asks
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;


CREATE OR REPLACE FUNCTION public.dismiss_closed_ask(p_ask_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_rows   INTEGER;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Caller must be a current member of the ask's group.
  IF NOT EXISTS (
    SELECT 1
    FROM public.sikw_asks a
    JOIN public.friend_group_members m
      ON m.group_id = a.group_id AND m.user_id = v_caller
    WHERE a.id = p_ask_id
  ) THEN
    RETURN FALSE;
  END IF;

  -- Stamp ask as dismissed for everyone. Race-safe: only the first
  -- dismiss wins; subsequent calls return false (already dismissed).
  UPDATE public.sikw_asks
     SET dismissed_at = now()
   WHERE id = p_ask_id
     AND dismissed_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;
