-- ============================================================================
-- CP8b — THE ONE-TIME CUTOVER MIGRATION  ***APPLIED 2026-06-24***
-- ============================================================================
-- DESTRUCTIVE + IRREVERSIBLE. Wiped every account except the five Beyond-the-
-- Underdome (BTU) users + the parked TSP seed, reshaped BTU's Paradise into the
-- new world, and tore down on-signup TSP provisioning. Spec §15.
--
-- STATUS: RAN SUCCESSFULLY on prod 2026-06-24 (full pre-cutover dump taken
-- first). Verified end state: 8 profiles survive (5 BTU + 3 fictional seed
-- authors), 5 logins (seed authors are profile-only), "Beyond the Underdome"
-- rebuilt with its 1 Paradise room. Kept as the historical record of exactly
-- what executed.
--
-- DO NOT RE-RUN. A re-run is harmless anyway: the BTU room is now parented, so
-- Step 0's "BTU Paradise room not uniquely found" assertion fires and rolls the
-- whole transaction back.
--
-- Safety design:
--   • ONE transaction (DO block) — any error/assertion RAISES + rolls back. No
--     partial cutover.
--   • STEP 0 resolves BTU/Paradise/seed dynamically and ABORTS on any mismatch.
--   • Deletes are scoped by OWNER, never by shared thread_id, and never touch an
--     is_seed author or tsp-seed row.
--
-- FK-safe delete order (the only RESTRICT blockers in the schema):
--     likes_replies -> replies ;  likes_threads -> threads ;
--     replies -> threads ;  {threads,replies,progress,likes} -> profiles
--   So: likes  ->  replies  ->  threads  ->  progress  ->  profiles  ->
--       auth.users. Everything else is ON DELETE CASCADE and is removed
--   automatically when its parent (profile / group / poll / thread) goes.
--
-- "KEEP" predicate for a thread/reply row R:
--     R.author_id = ANY(seed)                              -- parked TSP seed
--  OR (R.author_id = ANY(btu) AND R.show_id = paradise)    -- the BTU island
-- Everything else is deleted.
-- ============================================================================

DO $$
DECLARE
  v_paradise  text;
  v_btu_room  uuid;
  v_pg        uuid;
  v_owner     uuid;
  v_btu       uuid[];
  v_seed      uuid[];
  v_survivors uuid[];
  v_n         int;
BEGIN
  -- ========================================================================
  -- STEP 0 — RESOLVE + ASSERT (abort on any mismatch; no guessing)
  -- ========================================================================
  SELECT count(*) INTO v_n FROM public.shows WHERE lower(name) = 'paradise';
  IF v_n <> 1 THEN RAISE EXCEPTION 'CP8b ABORT: expected exactly 1 Paradise show, found %', v_n; END IF;
  SELECT id INTO v_paradise FROM public.shows WHERE lower(name) = 'paradise';

  SELECT array_agg(id) INTO v_btu FROM public.profiles
   WHERE username IN ('matthewgarcia80','libdenk','Jill','christinelovesshows','albokay');
  IF coalesce(array_length(v_btu,1),0) <> 5 THEN
    RAISE EXCEPTION 'CP8b ABORT: expected 5 BTU users, found %', coalesce(array_length(v_btu,1),0);
  END IF;
  SELECT id INTO v_owner FROM public.profiles WHERE username = 'albokay';

  SELECT fg.id INTO v_btu_room
    FROM public.friend_groups fg
   WHERE fg.show_id = v_paradise
     AND fg.parent_group_id IS NULL
     AND fg.deleted_at IS NULL
     AND (SELECT count(*) FROM public.friend_group_members m WHERE m.group_id = fg.id) = 5
     AND NOT EXISTS (SELECT 1 FROM public.friend_group_members m
                      WHERE m.group_id = fg.id AND NOT (m.user_id = ANY(v_btu)));
  IF v_btu_room IS NULL THEN
    RAISE EXCEPTION 'CP8b ABORT: BTU Paradise room (exactly the 5 members) not uniquely found';
  END IF;

  SELECT array_agg(id) INTO v_seed FROM public.profiles WHERE is_seed = true;
  v_survivors := v_btu || coalesce(v_seed, ARRAY[]::uuid[]);

  RAISE NOTICE 'CP8b resolved: paradise=%, room=%, btu=%, seed=%', v_paradise, v_btu_room, v_btu, v_seed;

  -- ========================================================================
  -- STEP 1 — Build the "Beyond the Underdome" people-group (§15.2)
  -- ========================================================================
  INSERT INTO public.people_groups (name, created_by)
       VALUES ('Beyond the Underdome', v_owner) RETURNING id INTO v_pg;
  INSERT INTO public.people_group_members (group_id, user_id, migration_dormant)
       SELECT v_pg, u, true FROM unnest(v_btu) AS u;     -- dormant until Paradise re-add
  UPDATE public.friend_groups SET parent_group_id = v_pg WHERE id = v_btu_room;

  -- ========================================================================
  -- STEP 2 — Reshape the BTU island into "removed-from-pool" (§15.2/15.3)
  -- ========================================================================
  UPDATE public.threads SET is_public = false, is_private = true
   WHERE author_id = ANY(v_btu) AND show_id = v_paradise AND is_public = true;   -- public -> private
  UPDATE public.profiles SET bio = NULL WHERE id = ANY(v_btu);                   -- drop bio
  DELETE FROM public.profile_thoughts WHERE author_id = ANY(v_btu);             -- drop "Thoughts on"
  UPDATE public.progress SET in_pool = false WHERE user_id = ANY(v_btu) AND show_id = v_paradise;
  UPDATE public.profiles SET onboarded_at = NULL, tsp_demo_seen_at = NULL WHERE id = ANY(v_btu);  -- fresh + tour
  DELETE FROM public.friend_group_departed_members WHERE group_id = v_btu_room;  -- no departed dots

  -- ========================================================================
  -- STEP 3 — Delete all NON-KEPT content, FK-safe (likes -> replies -> threads).
  --   Kept thread = seed-authored OR (BTU-authored AND Paradise).
  --   A reply is doomed if it isn't kept on its OWN criteria, OR its parent
  --   thread is doomed (a kept reply cannot outlive a deleted thread — that is
  --   the replies_thread_id_fkey we kept hitting). Compute the doomed sets once
  --   so likes / replies / threads all agree.
  -- ========================================================================
  CREATE TEMP TABLE _doomed_threads ON COMMIT DROP AS
    SELECT id FROM public.threads
     WHERE NOT (author_id = ANY(v_seed) OR (author_id = ANY(v_btu) AND show_id = v_paradise));

  CREATE TEMP TABLE _doomed_replies ON COMMIT DROP AS
    SELECT r.id FROM public.replies r
     WHERE NOT (r.author_id = ANY(v_seed) OR (r.author_id = ANY(v_btu) AND r.show_id = v_paradise))
        OR r.thread_id IN (SELECT id FROM _doomed_threads);

  -- likes first (likes_*_id -> replies/threads RESTRICT; user_id -> profiles RESTRICT)
  DELETE FROM public.likes_replies WHERE user_id <> ALL(v_survivors) OR reply_id  IN (SELECT id FROM _doomed_replies);
  DELETE FROM public.likes_threads WHERE user_id <> ALL(v_survivors) OR thread_id IN (SELECT id FROM _doomed_threads);
  -- then replies, then threads
  DELETE FROM public.replies WHERE id IN (SELECT id FROM _doomed_replies);
  DELETE FROM public.threads WHERE id IN (SELECT id FROM _doomed_threads);

  -- ========================================================================
  -- STEP 4 — Delete non-kept progress / ratings / browse
  --   (progress -> profiles is RESTRICT, so non-survivor rows MUST go here.)
  --   Keep: survivors' Paradise + the parked seed authors' rows.
  -- ========================================================================
  DELETE FROM public.progress        WHERE user_id <> ALL(v_survivors) OR (user_id = ANY(v_btu) AND show_id <> v_paradise);
  DELETE FROM public.episode_ratings WHERE user_id <> ALL(v_survivors) OR (user_id = ANY(v_btu) AND show_id <> v_paradise);
  DELETE FROM public.browse_progress WHERE user_id <> ALL(v_survivors) OR (user_id = ANY(v_btu) AND show_id <> v_paradise);

  -- ========================================================================
  -- STEP 5 — BTU "fresh except Paradise": structural cleanup (their profile
  --   survives, so these won't cascade — do them explicitly). Keep ONLY the BTU
  --   room membership + the new people-group membership.
  -- ========================================================================
  DELETE FROM public.group_show_votes     WHERE user_id = ANY(v_btu) AND show_id <> v_paradise;
  DELETE FROM public.people_group_members WHERE user_id = ANY(v_btu) AND group_id <> v_pg;
  -- their memberships in other friend rooms (keep the BTU room)
  DELETE FROM public.friend_group_members WHERE user_id = ANY(v_btu) AND group_id <> v_btu_room;
  -- friend rooms THEY created, other than the BTU room (cascades members/links/pings/polls)
  DELETE FROM public.friend_groups WHERE created_by = ANY(v_btu) AND id <> v_btu_room;
  -- their per-user TSP rooms reached by membership, regardless of creator (cascades links;
  -- the is_seed-authored tsp-seed THREADS are untouched — they aren't owned by these rooms)
  DELETE FROM public.friend_groups fg
   WHERE fg.show_id = 'tsp'
     AND EXISTS (SELECT 1 FROM public.friend_group_members m WHERE m.group_id = fg.id AND m.user_id = ANY(v_btu));
  -- other people-groups they created (keep BTU group)
  DELETE FROM public.people_groups WHERE created_by = ANY(v_btu) AND id <> v_pg;

  -- ========================================================================
  -- STEP 6 — TSP teardown (§15.5): stop auto-provisioning on signup.
  --   Function + canonical seed stay PARKED. (BTU per-user TSP rooms removed in 5.)
  -- ========================================================================
  DROP TRIGGER IF EXISTS on_new_profile_provision_sidebar ON public.profiles;

  -- ========================================================================
  -- STEP 7 — WIPE every non-survivor account. Their RESTRICT children
  --   (threads/replies/progress/likes) are already gone (Steps 3–4); deleting
  --   the profile cascades the rest (votes, memberships, groups they created,
  --   pings, polls, sikw, feedback, ratings, etc.). Then their login.
  -- ========================================================================
  DELETE FROM public.profiles WHERE id <> ALL(v_survivors);
  DELETE FROM auth.users      WHERE id <> ALL(v_survivors);

  RAISE NOTICE 'CP8b complete. survivors kept: % BTU + % seed.', array_length(v_btu,1), coalesce(array_length(v_seed,1),0);
END $$;
