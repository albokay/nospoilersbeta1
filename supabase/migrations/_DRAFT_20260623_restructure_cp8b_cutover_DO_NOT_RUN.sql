-- ============================================================================
-- CP8b — THE ONE-TIME CUTOVER MIGRATION  ***DRAFT — DO NOT RUN***
-- ============================================================================
-- DESTRUCTIVE + IRREVERSIBLE. Wipes every account except the five Beyond-the-
-- Underdome (BTU) users + the parked TSP seed, reshapes BTU's Paradise into the
-- new world, and tears down on-signup TSP provisioning. Spec §15.
--
-- GATING (spec §0 gate 2) — before running this on prod:
--   1. Apply CP8a first (this relies on people_group_members.migration_dormant).
--   2. Take a FRESH full dump (the binding backup).
--   3. Get an explicit go/no-go from Alborz.
--   4. STRONGLY RECOMMENDED: run + verify this against a LOCAL restore of the
--      dump first (prove survivors kept, everything else gone) before prod.
--
-- The filename is prefixed "_DRAFT_" so the migration runner will NOT pick it
-- up. Rename to a real timestamp only at run time.
--
-- Safety design:
--   • Entire operation is ONE transaction (DO block) — any assertion failure
--     RAISES and rolls everything back. Nothing partial.
--   • STEP 0 resolves BTU/Paradise/seed dynamically and ABORTS on any mismatch
--     (never guesses).
--   • The wipe is scoped strictly by OWNER (user_id / author_id / created_by),
--     NEVER by shared thread_id (the documented blast-radius incident), and
--     never touches an is_seed author or any tsp-seed row.
--
-- REVIEW markers (⚑) flag spots to confirm during the local test run.
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

  -- The BTU room = the un-parented Paradise friend room whose member set is
  -- EXACTLY those five users.
  SELECT fg.id INTO v_btu_room
    FROM public.friend_groups fg
   WHERE fg.show_id = v_paradise
     AND fg.parent_group_id IS NULL
     AND fg.deleted_at IS NULL
     AND (SELECT count(*) FROM public.friend_group_members m WHERE m.group_id = fg.id) = 5
     AND NOT EXISTS (
           SELECT 1 FROM public.friend_group_members m
            WHERE m.group_id = fg.id AND NOT (m.user_id = ANY(v_btu)));
  IF v_btu_room IS NULL THEN
    RAISE EXCEPTION 'CP8b ABORT: BTU Paradise room (exactly the 5 members) not uniquely found';
  END IF;

  -- Seed authors: parked TSP content owners — SURVIVORS, never touched.
  SELECT array_agg(id) INTO v_seed FROM public.profiles WHERE is_seed = true;
  v_survivors := v_btu || coalesce(v_seed, ARRAY[]::uuid[]);

  RAISE NOTICE 'CP8b resolved: paradise=%, room=%, btu=%, seed=%', v_paradise, v_btu_room, v_btu, v_seed;

  -- ========================================================================
  -- STEP 1 — Build the "Beyond the Underdome" people-group (§15.2)
  -- ========================================================================
  INSERT INTO public.people_groups (name, created_by)
       VALUES ('Beyond the Underdome', v_owner)
    RETURNING id INTO v_pg;

  INSERT INTO public.people_group_members (group_id, user_id, migration_dormant)
       SELECT v_pg, u, true FROM unnest(v_btu) AS u;   -- dormant until they re-add Paradise

  -- The existing Paradise friend room BECOMES this group's one show room
  -- (entries / replies / map / ratings all carry over untouched).
  UPDATE public.friend_groups SET parent_group_id = v_pg WHERE id = v_btu_room;

  -- ========================================================================
  -- STEP 2 — Reshape the BTU island into "removed-from-pool" (§15.2/15.3)
  -- ========================================================================
  -- Fold public Paradise posts into private writing.  ⚑ confirm flag semantics
  UPDATE public.threads SET is_public = false, is_private = true
   WHERE author_id = ANY(v_btu) AND show_id = v_paradise AND is_public = true;

  -- Drop bio + "Thoughts on" (decision C).
  UPDATE public.profiles SET bio = NULL WHERE id = ANY(v_btu);
  DELETE FROM public.profile_thoughts WHERE author_id = ANY(v_btu);

  -- Paradise out of pool → empty dashboard on first login (progress + ratings kept).
  UPDATE public.progress SET in_pool = false WHERE user_id = ANY(v_btu) AND show_id = v_paradise;

  -- Fresh first run: reset onboarding + SHOW THE TOUR (tsp_demo_seen_at = NULL).
  UPDATE public.profiles SET onboarded_at = NULL, tsp_demo_seen_at = NULL WHERE id = ANY(v_btu);

  -- No "departed" dots on the BTU columns (returning members, not leavers).
  DELETE FROM public.friend_group_departed_members WHERE group_id = v_btu_room;

  -- ========================================================================
  -- STEP 3 — Prune the 5 survivors to PARADISE-ONLY (§15.1 "fresh except Paradise")
  --   Everything of theirs for any OTHER show is wiped. Scoped by owner & show.
  -- ========================================================================
  DELETE FROM public.replies         WHERE author_id = ANY(v_btu) AND show_id <> v_paradise;
  DELETE FROM public.threads         WHERE author_id = ANY(v_btu) AND show_id <> v_paradise;
  DELETE FROM public.episode_ratings WHERE user_id  = ANY(v_btu) AND show_id <> v_paradise;
  DELETE FROM public.progress        WHERE user_id  = ANY(v_btu) AND show_id <> v_paradise;
  DELETE FROM public.browse_progress WHERE user_id  = ANY(v_btu) AND show_id <> v_paradise;
  DELETE FROM public.group_show_votes WHERE user_id = ANY(v_btu) AND show_id <> v_paradise;
  -- Their memberships in non-Paradise friend rooms (BTU room kept).
  DELETE FROM public.friend_group_members m
   WHERE m.user_id = ANY(v_btu) AND m.group_id <> v_btu_room
     AND NOT EXISTS (SELECT 1 FROM public.friend_groups fg
                      WHERE fg.id = m.group_id AND fg.show_id = v_paradise);
  -- Friend rooms THEY created for other shows.
  DELETE FROM public.friend_groups WHERE created_by = ANY(v_btu) AND show_id <> v_paradise AND id <> v_btu_room;
  -- Their other people-group memberships (BTU membership kept).
  DELETE FROM public.people_group_members WHERE user_id = ANY(v_btu) AND group_id <> v_pg;
  -- ⚑ REVIEW: their likes / pings / polls / sikw / highlights / messages tied to
  --    other shows or now-deleted rooms — enumerate + confirm during local test.

  -- ========================================================================
  -- STEP 4 — TSP teardown (§15.5) — keep the canonical seed PARKED
  -- ========================================================================
  -- Stop auto-provisioning TSP for new signups (function stays, just unhooked).
  DROP TRIGGER IF EXISTS on_new_profile_provision_sidebar ON public.profiles;

  -- Remove the 5 users' OWN per-user TSP rooms (container + links + their TSP
  -- progress/ratings) WITHOUT touching the is_seed-authored tsp-seed threads.
  DELETE FROM public.group_threads gt USING public.friend_groups fg
   WHERE gt.group_id = fg.id AND fg.show_id = 'tsp' AND fg.created_by = ANY(v_btu);
  DELETE FROM public.friend_group_members m USING public.friend_groups fg
   WHERE m.group_id = fg.id AND fg.show_id = 'tsp' AND fg.created_by = ANY(v_btu);
  DELETE FROM public.friend_groups   WHERE show_id = 'tsp' AND created_by = ANY(v_btu);
  DELETE FROM public.progress        WHERE user_id = ANY(v_btu) AND show_id = 'tsp';
  DELETE FROM public.episode_ratings WHERE user_id = ANY(v_btu) AND show_id = 'tsp';
  -- ⚑ REVIEW: confirm no remaining per-BTU 'tsp' engagement (likes/views) lingers.

  -- ========================================================================
  -- STEP 5 — WIPE every non-survivor account + content (§15.1)
  --   Scoped by OWNER only. Never by shared thread_id. Never an is_seed/tsp-seed
  --   row. Children before parents (no reliance on cascade unless verified).
  -- ========================================================================
  -- Engagement / leaf tables (by direct user/owner column):
  DELETE FROM public.likes_threads            WHERE user_id      <> ALL(v_survivors);
  DELETE FROM public.likes_replies            WHERE user_id      <> ALL(v_survivors);
  DELETE FROM public.friend_group_thread_views WHERE user_id     <> ALL(v_survivors);
  DELETE FROM public.user_thread_public_views WHERE user_id      <> ALL(v_survivors);
  DELETE FROM public.poll_dismissals          WHERE user_id      <> ALL(v_survivors);
  DELETE FROM public.sikw_dismissals          WHERE user_id      <> ALL(v_survivors);
  DELETE FROM public.poll_responses           WHERE responder_id <> ALL(v_survivors);
  DELETE FROM public.sikw_replies             WHERE replier_id   <> ALL(v_survivors);
  DELETE FROM public.browse_progress          WHERE user_id      <> ALL(v_survivors);
  DELETE FROM public.episode_ratings          WHERE user_id      <> ALL(v_survivors);
  DELETE FROM public.rate_limits              WHERE user_id      <> ALL(v_survivors);
  DELETE FROM public.feedback                 WHERE user_id      <> ALL(v_survivors);
  DELETE FROM public.highlights               WHERE author_id    <> ALL(v_survivors);
  DELETE FROM public.pings                    WHERE sender_id    <> ALL(v_survivors) OR recipient_id <> ALL(v_survivors);
  DELETE FROM public.group_show_votes         WHERE user_id      <> ALL(v_survivors);
  DELETE FROM public.group_messages           WHERE author_id    <> ALL(v_survivors);
  DELETE FROM public.pending_public_responses WHERE owner_id     <> ALL(v_survivors) OR requester_id <> ALL(v_survivors);
  DELETE FROM public.public_room_permissions  WHERE owner_id     <> ALL(v_survivors);
  DELETE FROM public.friend_group_departed_members WHERE user_id <> ALL(v_survivors);
  -- ⚑ REVIEW: response_citations, thread_prompts, poll_options, group_threads are
  --   keyed by parent (reply/thread/poll/group) id, not user. Confirm they cascade
  --   from the parent deletes below, OR add owner-joined deletes here.

  -- Content + polls/sikw (by author/asker):
  DELETE FROM public.replies   WHERE author_id <> ALL(v_survivors);
  DELETE FROM public.threads   WHERE author_id <> ALL(v_survivors);
  DELETE FROM public.polls     WHERE asker_id  <> ALL(v_survivors);
  DELETE FROM public.sikw_asks WHERE asker_id  <> ALL(v_survivors);

  -- Membership / groups / invitations (by member/creator):
  DELETE FROM public.friend_group_members    WHERE user_id    <> ALL(v_survivors);
  DELETE FROM public.friend_groups           WHERE created_by <> ALL(v_survivors);
  DELETE FROM public.people_group_members    WHERE user_id    <> ALL(v_survivors);
  DELETE FROM public.people_group_invitations WHERE created_by <> ALL(v_survivors);
  DELETE FROM public.people_groups           WHERE created_by <> ALL(v_survivors);
  DELETE FROM public.invitations             WHERE created_by <> ALL(v_survivors);
  DELETE FROM public.profile_thoughts        WHERE author_id  <> ALL(v_survivors);

  -- Finally the accounts themselves.
  DELETE FROM public.profiles WHERE id <> ALL(v_survivors);
  -- ⚑ REVIEW: auth.users — deleting non-survivors here removes their logins.
  --   Confirm FK direction (profiles.id -> auth.users.id) + that this DELETE is
  --   desired in the same transaction.
  DELETE FROM auth.users WHERE id <> ALL(v_survivors);

  RAISE NOTICE 'CP8b complete. survivors kept: % BTU + % seed.', array_length(v_btu,1), coalesce(array_length(v_seed,1),0);
END $$;
