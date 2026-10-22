-- ============================================================
-- 2026-10-22 — The friend who pulls ahead, CP4: "reached your letter".
--
-- A letter written while a friend is 3+ episodes behind its stamp is
-- remembered against that friend; when they reach the stamp, the author
-- hears about it in their daily email ("Priya reached S1 E5. Your letter
-- 'The break room' is open for them now."). The remembering happens here,
-- by trigger, the moment a letter is linked into a room — every path that
-- sends a letter (the room, the onboarding, a new group) is covered with
-- no client code. The digest run (service role) reads and stamps
-- reported_at. Nothing in the app reads this table.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.letter_watchers (
  thread_id     text NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  behind_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id     uuid NOT NULL,
  group_id      uuid NOT NULL REFERENCES public.friend_groups(id) ON DELETE CASCADE,
  stamp_season  integer NOT NULL,
  stamp_episode integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  reported_at   timestamptz,
  PRIMARY KEY (thread_id, behind_id)
);
CREATE INDEX IF NOT EXISTS letter_watchers_open_idx ON public.letter_watchers (reported_at) WHERE reported_at IS NULL;

ALTER TABLE public.letter_watchers ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: the trigger (definer) writes, the digest run reads.

-- The linear episode index of (season, episode) over a show's per-season
-- counts — the same arithmetic the app and the digest use.
CREATE OR REPLACE FUNCTION public.episode_index(p_season integer, p_episode integer, p_seasons integer[])
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(p_season, 0) <= 0 THEN 0
    ELSE coalesce((SELECT sum(x) FROM unnest(p_seasons[1:greatest(p_season - 1, 0)]) AS x), 0)::integer + coalesce(p_episode, 0)
  END;
$$;

CREATE OR REPLACE FUNCTION public.record_letter_watchers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author  uuid;
  v_season  integer;
  v_episode integer;
  v_show    text;
  v_seasons integer[];
  v_stamp   integer;
BEGIN
  SELECT t.author_id, t.season, t.episode INTO v_author, v_season, v_episode
    FROM public.threads t WHERE t.id = NEW.thread_id;
  IF v_author IS NULL OR v_author = '00000000-0000-4000-8000-000000000001'::uuid THEN RETURN NEW; END IF;
  SELECT fg.show_id, s.seasons INTO v_show, v_seasons
    FROM public.friend_groups fg JOIN public.shows s ON s.id = fg.show_id
   WHERE fg.id = NEW.group_id AND fg.parent_group_id IS NOT NULL;
  IF v_show IS NULL THEN RETURN NEW; END IF;
  v_stamp := public.episode_index(v_season, v_episode, coalesce(v_seasons, '{}'));
  IF v_stamp < 3 THEN RETURN NEW; END IF;

  INSERT INTO public.letter_watchers (thread_id, behind_id, author_id, group_id, stamp_season, stamp_episode)
  SELECT NEW.thread_id, m.user_id, v_author, NEW.group_id, coalesce(v_season, 0), coalesce(v_episode, 0)
    FROM public.friend_group_members m
    LEFT JOIN public.progress p ON p.user_id = m.user_id AND p.show_id = v_show
   WHERE m.group_id = NEW.group_id
     AND m.user_id <> v_author
     AND v_stamp - public.episode_index(
           CASE WHEN p.is_rewatching THEN greatest(coalesce(p.highest_season, 0), coalesce(p.season, 0)) ELSE coalesce(p.season, 0) END,
           CASE WHEN p.is_rewatching THEN greatest(coalesce(p.highest_episode, 0), coalesce(p.episode, 0)) ELSE coalesce(p.episode, 0) END,
           coalesce(v_seasons, '{}')) >= 3
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_letter_watchers ON public.group_threads;
CREATE TRIGGER record_letter_watchers
  AFTER INSERT ON public.group_threads
  FOR EACH ROW EXECUTE FUNCTION public.record_letter_watchers();

-- Verify (expect 'letter_watchers' and the trigger name):
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'letter_watchers';
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.group_threads'::regclass AND NOT tgisinternal;
