-- ============================================================
-- 2026-10-22 — The friend who pulls ahead, CP2: answering a nudge.
--
-- A nudged friend answers from a sheet: "I'm still in" / "I'll sit out
-- the rest", with a few words. The answer is a ping BACK to the nudger
-- (ping_type 'nudge_reply', reply_kind 'in' | 'out', reply_to = the nudge
-- it answers), written by the send-message function (service role) which
-- also stamps the answered nudges dismissed. The sheet opens by itself on
-- the nudged friend's next visit, once: "Later" stamps seen_at, after which
-- the nudge waits as the room's paper note instead.
-- ============================================================

ALTER TABLE public.pings DROP CONSTRAINT IF EXISTS pings_ping_type_check;
ALTER TABLE public.pings ADD CONSTRAINT pings_ping_type_check
  CHECK (ping_type = ANY (ARRAY['nudge_ahead'::text, 'nudge_same'::text, 'nudge_behind'::text, 'nudge_reply'::text]));

ALTER TABLE public.pings ADD COLUMN IF NOT EXISTS reply_kind text CHECK (reply_kind IN ('in', 'out'));
ALTER TABLE public.pings ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES public.pings(id) ON DELETE SET NULL;
ALTER TABLE public.pings ADD COLUMN IF NOT EXISTS seen_at timestamptz;

-- "Later": the caller has seen this room's nudges; they stop opening by
-- themselves (the paper note carries them until answered).
CREATE OR REPLACE FUNCTION public.mark_nudges_seen(p_group_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  UPDATE public.pings
     SET seen_at = now()
   WHERE recipient_id = auth.uid()
     AND group_id = p_group_id
     AND ping_type = 'nudge_ahead'
     AND dismissed_at IS NULL
     AND seen_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_nudges_seen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_nudges_seen(uuid) TO authenticated;

-- Verify (expect the four columns and 'nudge_reply' in the check):
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'pings' AND column_name IN ('reply_kind','reply_to','seen_at');
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'pings_ping_type_check';
