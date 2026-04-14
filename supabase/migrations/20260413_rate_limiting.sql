-- ── Rate-limiting infrastructure ──────────────────────────────────────────────
-- Server-side per-user rate limits enforced via SECURITY DEFINER RPCs.
-- No direct table access — only through check_rate_limit / check_rate_limit_daily.

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action       text        NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  count        int         NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, action, window_start)
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
-- No RLS policies — table is only accessed via SECURITY DEFINER functions.


-- ── Sliding-window rate limit ────────────────────────────────────────────────
-- Returns true if the action is allowed, false if the limit is exceeded.

CREATE OR REPLACE FUNCTION check_rate_limit(
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
  _uid   uuid := auth.uid();
  _now   timestamptz := now();
  _cutoff timestamptz := _now - (window_seconds || ' seconds')::interval;
  _count int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Purge expired entries for this user+action
  DELETE FROM rate_limits
  WHERE user_id = _uid
    AND action  = action_name
    AND window_start < _cutoff;

  -- Count remaining entries in the current window
  SELECT COALESCE(SUM(count), 0) INTO _count
  FROM rate_limits
  WHERE user_id      = _uid
    AND action       = action_name
    AND window_start >= _cutoff;

  IF _count >= max_count THEN
    RETURN false;
  END IF;

  -- Record the new action
  INSERT INTO rate_limits (user_id, action, window_start, count)
  VALUES (_uid, action_name, _now, 1);

  RETURN true;
END;
$$;


-- ── Daily rate limit ─────────────────────────────────────────────────────────
-- Returns true if the action is allowed within today's quota, false otherwise.

CREATE OR REPLACE FUNCTION check_rate_limit_daily(
  action_name text,
  max_daily   int
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid       uuid := auth.uid();
  _now       timestamptz := now();
  _day_start timestamptz := date_trunc('day', _now);
  _count     int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Purge entries older than today for this user+action
  DELETE FROM rate_limits
  WHERE user_id = _uid
    AND action  = action_name
    AND window_start < _day_start;

  -- Count today's entries
  SELECT COALESCE(SUM(count), 0) INTO _count
  FROM rate_limits
  WHERE user_id      = _uid
    AND action       = action_name
    AND window_start >= _day_start;

  IF _count >= max_daily THEN
    RETURN false;
  END IF;

  -- Record the new action
  INSERT INTO rate_limits (user_id, action, window_start, count)
  VALUES (_uid, action_name, _now, 1);

  RETURN true;
END;
$$;
