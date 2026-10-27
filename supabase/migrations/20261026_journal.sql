-- ============================================================
-- Journal arc (2026-10-26): a journal entry sent to a room, and a journal
-- handed over to a group as copies.
--
-- 1) group_threads.journal_kind — how a letter came from a journal:
--    'sent'     = the author sent the entry itself (it left the journal);
--    'handover' = a copy made by hand_over_journal (the journal keeps it).
--    NULL for every ordinary letter. The room's FROM line and the daily
--    email read it.
-- 2) threads.written_at — on a handed-over copy, when the entry was
--    originally written (the original's created_at). Display only: the
--    FROM line's "finished spring 2024" and the one-time card's date.
-- 3) hand_over_journal(room, thread ids) — copies the caller's picked
--    journal entries (writing with no link to a room they're currently in)
--    for the room's show into the room in ONE transaction
--    (no phantom drafts if a link fails), joins the caller to the room
--    (the "I'm in" the handover implies: vote row + pass cleared), and
--    skips any entry already handed to this room. Returns the count.
-- ============================================================

ALTER TABLE public.group_threads
  ADD COLUMN IF NOT EXISTS journal_kind TEXT
  CHECK (journal_kind IS NULL OR journal_kind IN ('sent', 'handover'));

ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS written_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.hand_over_journal(
  p_room_id    UUID,
  p_thread_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  UUID;
  v_parent  UUID;
  v_show    TEXT;
  v_src     RECORD;
  v_new_id  TEXT;
  v_count   INT := 0;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT parent_group_id, show_id INTO v_parent, v_show
  FROM public.friend_groups
  WHERE id = p_room_id AND deleted_at IS NULL;
  IF v_parent IS NULL OR v_show IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_room');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.people_group_members
    WHERE group_id = v_parent AND user_id = v_caller
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  -- Handing over puts you in the room: membership (re-join clears a
  -- departure), the yes vote, and no standing pass.
  DELETE FROM public.friend_group_departed_members
  WHERE group_id = p_room_id AND user_id = v_caller;
  INSERT INTO public.friend_group_members (group_id, user_id)
  SELECT p_room_id, v_caller
  WHERE NOT EXISTS (
    SELECT 1 FROM public.friend_group_members WHERE group_id = p_room_id AND user_id = v_caller
  );
  INSERT INTO public.group_show_votes (group_id, user_id, show_id)
  VALUES (v_parent, v_caller, v_show)
  ON CONFLICT DO NOTHING;
  DELETE FROM public.group_show_passes
  WHERE group_id = v_parent AND user_id = v_caller AND show_id = v_show;

  FOR v_src IN
    SELECT t.*
    FROM public.threads t
    WHERE t.id = ANY(p_thread_ids)
      AND t.author_id = v_caller
      AND t.show_id = v_show
      AND t.is_deleted = false
      AND t.is_public = false
      -- a journal entry: linked to no room the caller is IN. A letter in a
      -- room they've since left is theirs to hand over too (2026-10-26 fix:
      -- the app can't see that old link either, so it shows in the journal).
      AND NOT EXISTS (
        SELECT 1 FROM public.group_threads gt
        JOIN public.friend_group_members fm ON fm.group_id = gt.group_id AND fm.user_id = v_caller
        WHERE gt.thread_id = t.id
      )
      -- not already handed to this room
      AND NOT EXISTS (
        SELECT 1 FROM public.threads c
        JOIN public.group_threads gt2 ON gt2.thread_id = c.id AND gt2.group_id = p_room_id
        WHERE c.source_thread_id = t.id
      )
  LOOP
    v_new_id := gen_random_uuid()::text;
    INSERT INTO public.threads (
      id, show_id, season, episode, author_id, author_name, title, preview, body,
      is_public, is_rewatch, rewatch_season, rewatch_episode, from_season, from_episode,
      likes_count, source_thread_id, written_at
    ) VALUES (
      v_new_id, v_src.show_id, v_src.season, v_src.episode, v_src.author_id, v_src.author_name,
      v_src.title, v_src.preview, v_src.body,
      false, COALESCE(v_src.is_rewatch, false), v_src.rewatch_season, v_src.rewatch_episode,
      v_src.from_season, v_src.from_episode,
      0, v_src.id, v_src.created_at
    );
    INSERT INTO public.group_threads (group_id, thread_id, journal_kind)
    VALUES (p_room_id, v_new_id, 'handover');
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'room_id', p_room_id, 'count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hand_over_journal(UUID, TEXT[]) TO authenticated;
