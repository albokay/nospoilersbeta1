-- ============================================================
-- 2026-10-25 — "Thoughts on…" returns as an ask in the group chat, CP1.
--
-- Sidebar drops a "Thoughts on …" prompt into a people-group's chat as a
-- card pinned at the top (Alborz's call, 10-25). Sidebar has no auth user,
-- so the ask is NOT a group_messages row: it lives here and the chat page
-- draws it. Friends' takes are SEALED until yours is in — enforced in the
-- row policy, not just the UI (the deck's answer-to-reveal rule).
--
--   • ask_prompts   — the shared prompt list (the old profile library's 12),
--                     the one place later additions go.
--   • group_asks    — one ask per group at a time (closed_at NULL = open);
--                     earlier asks stay for paging back on the card.
--   • ask_takes     — one line per friend per ask; readable by others only
--                     once they have their own take on that ask.
--   • ask_views     — per person: when they first saw the card, and when
--                     every take was open for them and seen (the fold rule);
--                     the 3-day dot reads seen_at with no take.
--
-- Planting:
--   • The FIRST ask lands the instant a group's first show room is made
--     (trigger on friend_groups) — onboarding, the dashboard's new group,
--     an invitee's room: every path, no client code.
--   • plant_group_asks() is the cadence, to be called by the nightly run
--     (CP3) with the service key: a fresh prompt 14 days after everyone has
--     answered the open ask, or 28 days after it landed if someone never
--     does; held while the chat had a message in the last 48 hours; groups
--     with a room and no ask yet (today's 37) get their first one the same
--     way. Landing closes the previous ask. Not scheduled here.
-- ============================================================

-- ── The prompt list ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ask_prompts (
  key        text PRIMARY KEY,
  prompt     text NOT NULL,                 -- completes "Thoughts on …"
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ask_prompts (key, prompt) VALUES
  ('think_about',     'a show you think about more than you should'),
  ('defend',          'a show you defend to people who don''t like it'),
  ('wrong_time',      'a show you watched at the wrong time in your life'),
  ('ruined_others',   'a show that ruined other shows for you'),
  ('first_time',      'a show you wish you could watch for the first time again'),
  ('bonded',          'a show you and one specific person bonded over'),
  ('alone',           'a show you watched alone that you wish you''d watched with someone'),
  ('family',          'a show that made you think differently about your family'),
  ('sick_at_home',    'what you watch when you''re sick at home'),
  ('alone_vs_others', 'watching alone vs. with others'),
  ('never_finished',  'a show you started and never finished for a good reason'),
  ('comfort_rewatch', 'a show that''s a comfort rewatch')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.ask_prompts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ask_prompts_select ON public.ask_prompts;
CREATE POLICY ask_prompts_select ON public.ask_prompts
  FOR SELECT TO authenticated USING (true);

-- ── The asks ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_asks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES public.people_groups(id) ON DELETE CASCADE,
  prompt_key text NOT NULL REFERENCES public.ask_prompts(key),
  prompt     text NOT NULL,                 -- frozen copy, so a later edit of the list never rewrites history
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at  timestamptz                    -- set when the next ask lands
);
CREATE UNIQUE INDEX IF NOT EXISTS group_asks_one_open ON public.group_asks (group_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS group_asks_group_idx ON public.group_asks (group_id, created_at DESC);

ALTER TABLE public.group_asks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS group_asks_select_member ON public.group_asks;
CREATE POLICY group_asks_select_member ON public.group_asks
  FOR SELECT USING (public.is_member_of_people_group(group_id));
-- No client insert/update/delete: the trigger and the planting function write.

-- ── The takes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ask_takes (
  ask_id     uuid NOT NULL REFERENCES public.group_asks(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ask_id, user_id)
);

-- "Do I have a take on this ask?" — definer, so the select policy below can
-- ask it without recursing into its own table.
CREATE OR REPLACE FUNCTION public.auth_has_ask_take(p_ask_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.ask_takes WHERE ask_id = p_ask_id AND user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.auth_has_ask_take(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_has_ask_take(uuid) TO authenticated;

-- "Is this ask in one of my groups?"
CREATE OR REPLACE FUNCTION public.auth_is_ask_member(p_ask_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_asks a
    JOIN public.people_group_members m ON m.group_id = a.group_id
    WHERE a.id = p_ask_id AND m.user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.auth_is_ask_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_ask_member(uuid) TO authenticated;

ALTER TABLE public.ask_takes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ask_takes_select_sealed ON public.ask_takes;
CREATE POLICY ask_takes_select_sealed ON public.ask_takes
  FOR SELECT USING (
    user_id = auth.uid()
    OR (public.auth_is_ask_member(ask_id) AND public.auth_has_ask_take(ask_id))
  );
DROP POLICY IF EXISTS ask_takes_insert_own ON public.ask_takes;
CREATE POLICY ask_takes_insert_own ON public.ask_takes
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.auth_is_ask_member(ask_id));
-- No update/delete: a take is a line, sent once (a late take on an earlier ask still lands).

-- Who has answered, without their words: the card's sealed rows need the
-- names before the viewer has a take of their own.
CREATE OR REPLACE FUNCTION public.get_ask_answerers(p_ask_id uuid)
RETURNS TABLE (user_id uuid, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT t.user_id, t.created_at
  FROM public.ask_takes t
  WHERE t.ask_id = p_ask_id AND public.auth_is_ask_member(p_ask_id)
  ORDER BY t.created_at;
$$;
REVOKE ALL ON FUNCTION public.get_ask_answerers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ask_answerers(uuid) TO authenticated;

-- ── Seen stamps (open-on-new, the fold rule, the 3-day dot) ─────────────
-- The card opens on entering the chat when the viewer has no take yet, or
-- when any take they can see is newer than last_opened_at (Alborz 10-25);
-- otherwise it is folded. The 3-day dot reads seen_at with no take.
CREATE TABLE IF NOT EXISTS public.ask_views (
  ask_id         uuid NOT NULL REFERENCES public.group_asks(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seen_at        timestamptz NOT NULL DEFAULT now(),   -- the card was first on screen
  last_opened_at timestamptz,                          -- the last time they had the card open
  PRIMARY KEY (ask_id, user_id)
);
ALTER TABLE public.ask_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ask_views_own ON public.ask_views;
CREATE POLICY ask_views_own ON public.ask_views
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND public.auth_is_ask_member(ask_id));

-- ── Planting ────────────────────────────────────────────────────────────
-- A prompt this group hasn't had; when the list is used up, the one it had
-- longest ago.
CREATE OR REPLACE FUNCTION public.pick_ask_prompt(p_group_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.key
  FROM public.ask_prompts p
  LEFT JOIN LATERAL (
    SELECT max(a.created_at) AS last_used
    FROM public.group_asks a WHERE a.group_id = p_group_id AND a.prompt_key = p.key
  ) u ON true
  WHERE p.active
  ORDER BY (u.last_used IS NULL) DESC, u.last_used ASC NULLS FIRST, random()
  LIMIT 1;
$$;

-- Close the open ask (if any) and open a new one. Internal: the trigger and
-- the planting function call it.
CREATE OR REPLACE FUNCTION public.open_group_ask(p_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_id  uuid;
BEGIN
  v_key := public.pick_ask_prompt(p_group_id);
  IF v_key IS NULL THEN RETURN NULL; END IF;
  UPDATE public.group_asks SET closed_at = now() WHERE group_id = p_group_id AND closed_at IS NULL;
  INSERT INTO public.group_asks (group_id, prompt_key, prompt)
  SELECT p_group_id, v_key, p.prompt FROM public.ask_prompts p WHERE p.key = v_key
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.open_group_ask(uuid) FROM PUBLIC, anon, authenticated;

-- The first ask: the instant a group gets its first show room.
CREATE OR REPLACE FUNCTION public.first_ask_on_first_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_group_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.group_asks WHERE group_id = NEW.parent_group_id) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.people_groups g WHERE g.id = NEW.parent_group_id AND g.deleted_at IS NOT NULL) THEN RETURN NEW; END IF;
  PERFORM public.open_group_ask(NEW.parent_group_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS first_ask_on_first_room ON public.friend_groups;
CREATE TRIGGER first_ask_on_first_room
  AFTER INSERT ON public.friend_groups
  FOR EACH ROW EXECUTE FUNCTION public.first_ask_on_first_room();

-- The cadence. Returns how many asks landed. Service role only (the nightly
-- run calls it, CP3); nothing schedules it here.
CREATE OR REPLACE FUNCTION public.plant_group_asks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  n integer := 0;
BEGIN
  FOR g IN
    SELECT pg.id
    FROM public.people_groups pg
    WHERE pg.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.friend_groups f WHERE f.parent_group_id = pg.id AND f.deleted_at IS NULL)
      -- quiet: no chat message in the last 48 hours
      AND NOT EXISTS (SELECT 1 FROM public.group_messages gm WHERE gm.group_id = pg.id AND gm.created_at > now() - interval '48 hours')
      AND (
        -- no ask yet (a group from before this shipped)
        NOT EXISTS (SELECT 1 FROM public.group_asks a WHERE a.group_id = pg.id)
        OR EXISTS (
          SELECT 1 FROM public.group_asks a
          WHERE a.group_id = pg.id AND a.closed_at IS NULL
            AND (
              -- 28 days after it landed, whoever is still missing
              a.created_at <= now() - interval '28 days'
              OR (
                -- everyone (not dormant) has answered, and the last take is 14 days old
                NOT EXISTS (
                  SELECT 1 FROM public.people_group_members m
                  WHERE m.group_id = pg.id AND NOT m.migration_dormant
                    AND NOT EXISTS (SELECT 1 FROM public.ask_takes t WHERE t.ask_id = a.id AND t.user_id = m.user_id)
                )
                AND (SELECT max(t.created_at) FROM public.ask_takes t WHERE t.ask_id = a.id) <= now() - interval '14 days'
              )
            )
        )
      )
  LOOP
    IF public.open_group_ask(g.id) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.plant_group_asks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plant_group_asks() TO service_role;

-- Verify (expect 4 tables, 12 prompts, and the trigger name):
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('ask_prompts','group_asks','ask_takes','ask_views') ORDER BY 1;
-- SELECT count(*) FROM public.ask_prompts;
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.friend_groups'::regclass AND NOT tgisinternal;
