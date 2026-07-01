-- ============================================================================
-- 2026-06-30 — Service-role-callable rate-limit variants.
--
-- The email edge functions (send-invite / send-group-invite / send-message)
-- cannot call check_rate_limit / check_rate_limit_daily (which key on
-- auth.uid()) via a user-scoped client: supabase-js in the Deno edge runtime
-- returns "Auth session missing!" for such a client, so those rate-limit calls
-- were silently FAILING OPEN (no enforcement). These variants take an explicit
-- p_user_id and are invoked from the service-role admin client with the
-- JWT-verified caller id. Same sliding-window / daily logic as the originals.
--
-- Locked to service_role only. The original auth.uid() functions are unchanged
-- and still used by the frontend directly.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_rate_limit_for(
  p_user_id      uuid,
  action_name    text,
  max_count      int,
  window_seconds int DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid    uuid := p_user_id;
  _now    timestamptz := now();
  _cutoff timestamptz := _now - (window_seconds || ' seconds')::interval;
  _count  int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;

  DELETE FROM rate_limits
  WHERE user_id = _uid AND action = action_name AND window_start < _cutoff;

  SELECT COALESCE(SUM(count), 0) INTO _count
  FROM rate_limits
  WHERE user_id = _uid AND action = action_name AND window_start >= _cutoff;

  IF _count >= max_count THEN
    RETURN false;
  END IF;

  INSERT INTO rate_limits (user_id, action, window_start, count)
  VALUES (_uid, action_name, _now, 1);

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_rate_limit_daily_for(
  p_user_id   uuid,
  action_name text,
  max_daily   int
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid       uuid := p_user_id;
  _now       timestamptz := now();
  _day_start timestamptz := date_trunc('day', _now);
  _count     int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;

  DELETE FROM rate_limits
  WHERE user_id = _uid AND action = action_name AND window_start < _day_start;

  SELECT COALESCE(SUM(count), 0) INTO _count
  FROM rate_limits
  WHERE user_id = _uid AND action = action_name AND window_start >= _day_start;

  IF _count >= max_daily THEN
    RETURN false;
  END IF;

  INSERT INTO rate_limits (user_id, action, window_start, count)
  VALUES (_uid, action_name, _now, 1);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit_for(uuid, text, int, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_rate_limit_daily_for(uuid, text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit_for(uuid, text, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit_daily_for(uuid, text, int) TO service_role;
