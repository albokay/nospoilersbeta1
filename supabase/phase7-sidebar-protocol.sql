-- ============================================================
-- Phase 7: The Sidebar Protocol — Seeded Friend Room
--
-- Every new user automatically receives a personal copy of a
-- pre-seeded friend room called "The Sidebar Protocol", built
-- around a fictional spy show of the same name.
--
-- Architecture:
--   • One shared set of seed threads (tsp-seed-a … tsp-seed-g)
--   • Each user's room gets its own group_threads links + its
--     own reply rows (group_id scopes them to that room)
--   • Three fictional seed profiles (Maya, James, Sarah) with
--     is_seed = true — no real auth accounts needed
--   • A SECURITY DEFINER function provisions each new user's room
--   • An AFTER INSERT trigger on profiles fires automatically
--   • Backfill at the bottom covers all existing users
-- ============================================================


-- ── 0. Extend shows table (optional future columns) ──────────────────────────

ALTER TABLE shows ADD COLUMN IF NOT EXISTS year        integer;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS description text;


-- ── 1. Insert the fictional show ─────────────────────────────────────────────

INSERT INTO shows (id, name, seasons, year, description)
VALUES ('tsp', 'The Sidebar Protocol', ARRAY[6], 2026, 'fake friends, real room (sorta)')
ON CONFLICT (id) DO NOTHING;


-- ── 2. Insert fictional seed profiles ────────────────────────────────────────
-- profiles.id has no FK to auth.users, so fixed UUIDs are safe.
-- is_seed = true excludes these from the new-user provisioning trigger.

INSERT INTO profiles (id, username, is_seed) VALUES
  ('00000000-0000-0000-0001-000000000001', 'Maya',  true),
  ('00000000-0000-0000-0001-000000000002', 'James', true),
  ('00000000-0000-0000-0001-000000000003', 'Sarah', true)
ON CONFLICT (id) DO NOTHING;


-- ── 3. Insert seed threads (shared; one copy for all user rooms) ─────────────
-- is_public = false — these are private to friend rooms only.
-- updated_at reflects the timeline of the last reply in each thread.

INSERT INTO threads (
  id, show_id, season, episode,
  author_id, author_name,
  title, preview, body,
  is_public, likes_count,
  created_at, updated_at
) VALUES

  -- Entry A: Maya, S01E02
  ('tsp-seed-a', 'tsp', 1, 2,
   '00000000-0000-0000-0001-000000000001', 'Maya',
   'Episode 2 — Nadia is a double agent and I am on the floor',
   'The reveal at the end of episode two that Nadia has been feeding Berlin intelligence to a third party this whole time — I did not see it coming and I feel genuinely betrayed. Not by the show. By Nadia.',
   'The reveal at the end of episode two that Nadia has been feeding Berlin intelligence to a third party this whole time — I did not see it coming and I feel genuinely betrayed. Not by the show. By Nadia. I trusted her. The show made me trust her and then pulled it away so quietly. No dramatic music. Just Reyes reading a file and the camera on her face and I understood exactly what it meant.',
   false, 0,
   now() - interval '13 days', now() - interval '3 days'),

  -- Entry B: James, S01E01
  ('tsp-seed-b', 'tsp', 1, 1,
   '00000000-0000-0000-0001-000000000002', 'James',
   'Episode 1 — this show refuses to be a normal spy show',
   'It feels like Sidebar Protocol isn''t doing the things spy shows do. No action, no gadgets — the Berlin asset spent most of episode one sitting in a café pretending to read a newspaper.',
   'It feels like Sidebar Protocol isn''t doing the things spy shows do. No action, no gadgets — the Berlin asset spent most of episode one sitting in a café pretending to read a newspaper. It was more tense than anything in the last three spy shows I watched. It seems like this show knows how to be quiet and exactly when to detonate something.',
   false, 0,
   now() - interval '14 days', now() - interval '9 days'),

  -- Entry C: James, S01E04
  ('tsp-seed-c', 'tsp', 1, 4,
   '00000000-0000-0000-0001-000000000002', 'James',
   'Episode 4 — Reyes pulled Omar out alive and didn''t tell anyone',
   'Omar didn''t die in Beirut. Reyes extracted him herself, off the books, without telling the agency. She''s been hiding him. I spent all of episode three grieving Omar and the entire time Reyes knew he was alive.',
   'Omar didn''t die in Beirut. Reyes extracted him herself, off the books, without telling the agency. She''s been hiding him. I spent all of episode three grieving Omar and the entire time Reyes knew he was alive. The show made me feel that grief for a reason — it wanted me to understand what Reyes is willing to do unilaterally. She doesn''t trust the agency with the people she runs. That changes everything about how I read her.',
   false, 0,
   now() - interval '10 days', now() - interval '3 days'),

  -- Entry D: Sarah, S01E02
  ('tsp-seed-d', 'tsp', 1, 2,
   '00000000-0000-0000-0001-000000000003', 'Sarah',
   'Episode 2 — when that safe house goes up in flames, remember where everyone was standing',
   'The show hides its power dynamics in the architecture. The briefing rooms are always slightly too small. Reyes always has her back to something solid. The assets are always near the door.',
   'The show hides its power dynamics in the architecture. The briefing rooms are always slightly too small. Reyes always has her back to something solid. The assets are always near the door. And now knowing that Nadia is a double agent, I keep thinking about how she always positioned herself closest to the exit. The show was telling us with blocking what it wasn''t ready to say with dialogue.',
   false, 0,
   now() - interval '12 days', now() - interval '10 days'),

  -- Entry E: Sarah, S01E04
  ('tsp-seed-e', 'tsp', 1, 4,
   '00000000-0000-0000-0001-000000000003', 'Sarah',
   'Episode 4 — Elena figured out the three operations were never independent',
   'Elena in Buenos Aires has been running the numbers and she''s realized that Berlin, Beirut and Buenos Aires weren''t three separate operations. They were one operation split into three parts and none of the assets knew they were connected.',
   'Elena in Buenos Aires has been running the numbers and she''s realized that Berlin, Beirut and Buenos Aires weren''t three separate operations. They were one operation split into three parts and none of the assets knew they were connected. Which means Reyes knew the whole shape of it and gave each of them only the piece she wanted them to have. Elena is furious. I am furious on her behalf. And I can''t decide if Reyes was protecting them or using them.',
   false, 0,
   now() - interval '9 days', now() - interval '3 days'),

  -- Entry F: Sarah, S01E05
  ('tsp-seed-f', 'tsp', 1, 5,
   '00000000-0000-0000-0001-000000000003', 'Sarah',
   'Episode 5 — Elena is the emotional center of this show and I wasn''t ready',
   'I''ve been so focused on Reyes that I almost missed what''s happening with Elena. Episode five is the first time we''ve really been with her and I was completely undone by the end of it.',
   'I''ve been so focused on Reyes that I almost missed what''s happening with Elena. Episode five is the first time we''ve really been with her and I was completely undone by the end of it. There''s a scene where she describes what she gave up to do this work — her daughter''s first years, her mother''s last ones — and it lands harder than anything else in the show because it''s the first time the cost of the work has been this specific and this personal. Reyes''s operation used that sacrifice. I''m not sure I can forgive the show for making me love Elena right before what I think is coming.',
   false, 0,
   now() - interval '7 days', now() - interval '3 days'),

  -- Entry G: Sarah, S01E06
  ('tsp-seed-g', 'tsp', 1, 6,
   '00000000-0000-0000-0001-000000000003', 'Sarah',
   'Episode 6 — Reyes defects and she was Nadia''s handler all along',
   'Reyes is the third party. She was the one Nadia was feeding Berlin intelligence to the whole time. She didn''t discover the double agent — she created her.',
   'Reyes is the third party. She was the one Nadia was feeding Berlin intelligence to the whole time. She didn''t discover the double agent — she created her. The defection at the end of episode six reframes the entire series and I''ve changed my read on Reyes three times since finishing the episode. Is she a traitor? A whistleblower? Someone who built an operation inside an operation because she stopped believing in the institution? The show doesn''t tell you. It just shows you her face as she crosses and leaves you with that.' || chr(10) || chr(10) || 'James — your filter idea from the episode three thread means something very specific now. The filter was always her.',
   false, 0,
   now() - interval '2 days', now() - interval '2 days')

ON CONFLICT (id) DO NOTHING;


-- ── 4. Provision function ─────────────────────────────────────────────────────
-- Creates one personal Sidebar Protocol room for a given user:
--   • friend_groups row (user is creator/owner)
--   • friend_group_members row
--   • group_threads rows linking all 7 seed threads
--   • 14 reply rows scoped to this group (group_id)
--   • progress row (s=1, e=0) so the show appears in their list

CREATE OR REPLACE FUNCTION provision_sidebar_protocol(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  -- 1. Create the group owned by the user
  INSERT INTO friend_groups (show_id, name, created_by)
  VALUES ('tsp', 'The Sidebar Protocol', p_user_id)
  RETURNING id INTO v_group_id;

  -- 2. Add the user as a member
  INSERT INTO friend_group_members (group_id, user_id)
  VALUES (v_group_id, p_user_id);

  -- 3. Link all seed threads to this group
  --    shared_at is staggered so threads sort in episode order (newest at top)
  INSERT INTO group_threads (group_id, thread_id, shared_at) VALUES
    (v_group_id, 'tsp-seed-b', now() - interval '14 days'),
    (v_group_id, 'tsp-seed-a', now() - interval '13 days'),
    (v_group_id, 'tsp-seed-d', now() - interval '12 days'),
    (v_group_id, 'tsp-seed-c', now() - interval '10 days'),
    (v_group_id, 'tsp-seed-e', now() - interval '9 days'),
    (v_group_id, 'tsp-seed-f', now() - interval '7 days'),
    (v_group_id, 'tsp-seed-g', now() - interval '2 days');

  -- 4. Seed replies — one fresh set per user room, scoped to v_group_id

  INSERT INTO replies (
    id, thread_id, show_id, season, episode,
    author_id, author_name, body,
    likes_count, group_id,
    created_at, updated_at
  ) VALUES

    -- ── Thread A (Maya, S01E02) ───────────────────────────────────────────
    (gen_random_uuid()::text, 'tsp-seed-a', 'tsp', 1, 2,
     '00000000-0000-0000-0001-000000000002', 'James',
     'The quietness of it is what got me. Any other show would have made that a big moment. This one just lets you sit with it. And the worst part is going back to episode one knowing what she is. She''s so warm. She''s so convincingly warm.',
     0, v_group_id,
     now() - interval '13 days' + interval '2 hours',
     now() - interval '13 days' + interval '2 hours'),

    (gen_random_uuid()::text, 'tsp-seed-a', 'tsp', 1, 2,
     '00000000-0000-0000-0001-000000000003', 'Sarah',
     'I keep thinking about who Nadia is feeding the intelligence to. The show doesn''t tell us yet. Reyes knows — you can see it in her face — but she doesn''t say it out loud. That omission feels deliberate.',
     0, v_group_id,
     now() - interval '13 days' + interval '5 hours',
     now() - interval '13 days' + interval '5 hours'),

    (gen_random_uuid()::text, 'tsp-seed-a', 'tsp', 1, 4,
     '00000000-0000-0000-0001-000000000002', 'James',
     'Coming back to this after episode four. Sarah''s question about who Nadia is feeding gets answered and it destroyed me. Everything in this thread looks different now.',
     0, v_group_id,
     now() - interval '10 days' + interval '1 hour',
     now() - interval '10 days' + interval '1 hour'),

    (gen_random_uuid()::text, 'tsp-seed-a', 'tsp', 1, 4,
     '00000000-0000-0000-0001-000000000003', 'Sarah',
     'James. The answer to my own question broke me completely. I should have seen it.',
     0, v_group_id,
     now() - interval '10 days' + interval '3 hours',
     now() - interval '10 days' + interval '3 hours'),

    (gen_random_uuid()::text, 'tsp-seed-a', 'tsp', 1, 6,
     '00000000-0000-0000-0001-000000000003', 'Sarah',
     'By episode six the Nadia reveal is just the first domino. The whole series is one long controlled fall and episode two is where it starts. Rewatch it.',
     0, v_group_id,
     now() - interval '2 days' + interval '1 hour',
     now() - interval '2 days' + interval '1 hour'),

    -- ── Thread B (James, S01E01) ──────────────────────────────────────────
    (gen_random_uuid()::text, 'tsp-seed-b', 'tsp', 1, 2,
     '00000000-0000-0000-0001-000000000001', 'Maya',
     '"Quiet and then detonate" is exactly the grammar of it. And when we find out about Nadia, every quiet moment feels like it might be hiding another detonation.',
     0, v_group_id,
     now() - interval '13 days' + interval '3 hours',
     now() - interval '13 days' + interval '3 hours'),

    (gen_random_uuid()::text, 'tsp-seed-b', 'tsp', 1, 4,
     '00000000-0000-0000-0001-000000000003', 'Sarah',
     'Speaking to you from the future — to bounce off of what Maya said, I can''t wait for your reaction when you realize all the detonations were planned from the beginning. The quiet isn''t just tone. It''s structure.',
     0, v_group_id,
     now() - interval '9 days' + interval '2 hours',
     now() - interval '9 days' + interval '2 hours'),

    -- ── Thread C (James, S01E04) ──────────────────────────────────────────
    (gen_random_uuid()::text, 'tsp-seed-c', 'tsp', 1, 4,
     '00000000-0000-0000-0001-000000000003', 'Sarah',
     'The Omar reveal reframes every scene with Reyes in episodes two and three. She was managing her own grief about him going dark while pretending to manage everyone else''s. The performance within the performance. The show is doing something really precise about what it costs to hold that much information alone.',
     0, v_group_id,
     now() - interval '10 days' + interval '2 hours',
     now() - interval '10 days' + interval '2 hours'),

    (gen_random_uuid()::text, 'tsp-seed-c', 'tsp', 1, 4,
     '00000000-0000-0000-0001-000000000002', 'James',
     'Sarah — "the performance within the performance" is the whole show. Every character is performing for someone. The question is who''s watching.',
     0, v_group_id,
     now() - interval '10 days' + interval '4 hours',
     now() - interval '10 days' + interval '4 hours'),

    (gen_random_uuid()::text, 'tsp-seed-c', 'tsp', 1, 6,
     '00000000-0000-0000-0001-000000000003', 'Sarah',
     'By episode six the answer to James''s question — who''s watching — is so much more specific and devastating than I expected. The surveillance in this show is not metaphorical.',
     0, v_group_id,
     now() - interval '2 days' + interval '2 hours',
     now() - interval '2 days' + interval '2 hours'),

    -- ── Thread D (Sarah, S01E02) ──────────────────────────────────────────
    (gen_random_uuid()::text, 'tsp-seed-d', 'tsp', 1, 4,
     '00000000-0000-0000-0001-000000000002', 'James',
     'Rewatched episode one after your entry and the door thing is everywhere. Also: Reyes is always lit slightly warmer than everyone else in group scenes. Like she''s the only one who belongs there. Now I''m wondering if that''s sinister rather than authoritative.',
     0, v_group_id,
     now() - interval '10 days' + interval '6 hours',
     now() - interval '10 days' + interval '6 hours'),

    -- ── Thread E (Sarah, S01E04) ──────────────────────────────────────────
    (gen_random_uuid()::text, 'tsp-seed-e', 'tsp', 1, 4,
     '00000000-0000-0000-0001-000000000002', 'James',
     'The single operation reveal makes the Omar extraction make more sense. Reyes wasn''t just protecting Omar — she was protecting a piece of the larger play. Which makes it more chilling, not less.',
     0, v_group_id,
     now() - interval '9 days' + interval '3 hours',
     now() - interval '9 days' + interval '3 hours'),

    (gen_random_uuid()::text, 'tsp-seed-e', 'tsp', 1, 6,
     '00000000-0000-0000-0001-000000000003', 'Sarah',
     'Episode six answers the protecting vs. using question and the answer is that those were never opposites for Reyes. She was doing both simultaneously the whole time and she''d argue there was no other way.',
     0, v_group_id,
     now() - interval '2 days' + interval '3 hours',
     now() - interval '2 days' + interval '3 hours'),

    -- ── Thread F (Sarah, S01E05) ──────────────────────────────────────────
    (gen_random_uuid()::text, 'tsp-seed-f', 'tsp', 1, 6,
     '00000000-0000-0000-0001-000000000003', 'Sarah',
     'Writing a response to my own entry just to say: what I thought was coming did come. Episode six uses everything episode five built. The Elena thread in this show is the one that will stay with me longest.',
     0, v_group_id,
     now() - interval '2 days' + interval '4 hours',
     now() - interval '2 days' + interval '4 hours');

    -- (Entry G has no replies — Sarah''s final entry stands alone)

  -- 5. Auto-insert a progress row (s=1, e=0) so the show appears in the
  --    user''s show list and profile journal tabs immediately.
  --    The user sets their real progress when they enter the show.
  INSERT INTO progress (user_id, show_id, season, episode)
  VALUES (p_user_id, 'tsp', 1, 0)
  ON CONFLICT (user_id, show_id) DO NOTHING;

END;
$$;


-- ── 5. Trigger function ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_provision_sidebar_protocol()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip seed profiles (Maya, James, Sarah) and only provision real users
  IF NEW.is_seed IS DISTINCT FROM true THEN
    PERFORM provision_sidebar_protocol(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


-- ── 6. Attach trigger to profiles ────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_new_profile_provision_sidebar ON profiles;

CREATE TRIGGER on_new_profile_provision_sidebar
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_provision_sidebar_protocol();


-- ── 7. Backfill all existing real users ──────────────────────────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM profiles
    WHERE is_seed IS DISTINCT FROM true
  LOOP
    -- Idempotent: skip users who already have a TSP group
    IF NOT EXISTS (
      SELECT 1 FROM friend_groups
      WHERE created_by = r.id AND show_id = 'tsp'
    ) THEN
      PERFORM provision_sidebar_protocol(r.id);
    END IF;
  END LOOP;
END;
$$;
