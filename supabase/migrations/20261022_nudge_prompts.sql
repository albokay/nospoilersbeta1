-- ============================================================
-- 2026-10-22 — The friend who pulls ahead, CP3: the daily email's prompt.
--
-- The nightly digest run prompts an AHEAD friend to nudge a friend 3+
-- episodes behind ("Sam's at S1 E3, four episodes behind you, and has been
-- for a few days. A word from you might bring them back. Nudge Sam →").
-- This table is the run's memory: one row per (room, ahead, behind) says
-- the prompt went out, so it goes out once; the run deletes the row again
-- once the behind friend has come within 2 episodes, so a friend who
-- catches up and falls behind again earns a fresh prompt. Service role
-- only — nothing in the app reads or writes it.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.nudge_prompts (
  group_id    uuid NOT NULL REFERENCES public.friend_groups(id) ON DELETE CASCADE,
  ahead_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  behind_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompted_at timestamptz NOT NULL DEFAULT now(),
  gap         integer NOT NULL,
  PRIMARY KEY (group_id, ahead_id, behind_id)
);

ALTER TABLE public.nudge_prompts ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service role (the digest run) touches it.

-- Verify (expect one row):
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'nudge_prompts';
