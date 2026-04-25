-- ============================================================
-- Rename default TSP friend room: "The Sidebar Protocol" → "TSP friends"
-- 2026-04-25
-- ============================================================
-- Two-part change:
--   1. Update existing rooms whose name is still the default
--      "The Sidebar Protocol" to "TSP friends". User-customized
--      names are PRESERVED — only the literal default value is
--      replaced. (If a user has renamed their TSP room to
--      something custom, we don't override their choice.)
--   2. CREATE OR REPLACE provision_sidebar_protocol so future
--      signups get "TSP friends" as the default name. Body is
--      identical to the prior definition in
--      phase7-sidebar-protocol.sql except for the name literal
--      on the friend_groups INSERT.
--
-- Apply manually in the Supabase SQL editor.
-- ============================================================


-- ── 1. Existing rooms ──

UPDATE friend_groups
SET name = 'TSP friends'
WHERE show_id = 'tsp'
  AND name = 'The Sidebar Protocol';


-- ── 2. Future signups ──

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
  VALUES ('tsp', 'TSP friends', p_user_id)
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

    -- (Entry G has no replies — Sarah's final entry stands alone)

  -- 5. Auto-insert a progress row (s=1, e=1) so the user opens to a
  --    fully-populated room — canView({s:1, e:1}, {s:1, e:1}) is true,
  --    so all seeded S1 threads are visible immediately. User can
  --    rewind via the picker if they want; the demo is meant to land
  --    populated, not empty.
  INSERT INTO progress (user_id, show_id, season, episode)
  VALUES (p_user_id, 'tsp', 1, 1)
  ON CONFLICT (user_id, show_id) DO NOTHING;

END;
$$;


-- ── Verify ──
-- After applying, every TSP room should be on either "TSP friends" or
-- a user-customized name (no rows on the old default).
SELECT name, count(*) AS room_count
FROM friend_groups
WHERE show_id = 'tsp'
GROUP BY name
ORDER BY room_count DESC;
