-- ============================================================
-- Journal: Send is a COPY now (2026-10-28, his decision after the 10-27
-- brainstorm — "You can use your journal in two ways").
--
-- send_journal_entry(thread id, room ids) — copies ONE of the caller's
-- journal entries into each of the given rooms in one transaction, as the
-- handover does (source_thread_id + written_at on the copy), linked with
-- journal_kind 'sent' so the room's FROM line and the daily email read it
-- as a sent letter (no "opened their journal" card). The entry STAYS in
-- the journal. Per room: the room must exist for the entry's show, the
-- caller must be a member of its parent group, a room that already holds
-- a copy of this entry (sent or handed over) is skipped, and the caller
-- joins the room (member row, departure cleared, yes vote, pass cleared).
-- Returns the rooms that received a copy.
--
-- The 10-26 `sent` rows (the old MOVE: the entry itself linked into the
-- room) are left as they are.
-- ============================================================

CREATE OR REPLACE FUNCTION public.send_journal_entry(
  p_thread_id TEXT,
  p_room_ids  UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  UUID;
  v_src     RECORD;
  v_room    UUID;
  v_parent  UUID;
  v_show    TEXT;
  v_new_id  TEXT;
  v_sent    UUID[] := ARRAY[]::UUID[];
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT t.* INTO v_src
  FROM public.threads t
  WHERE t.id = p_thread_id
    AND t.author_id = v_caller
    AND t.is_deleted = false
    AND t.is_public = false
    -- a journal entry: linked to no room the caller is IN (the app's own
    -- definition; a letter in a room they've since left counts as theirs).
    AND NOT EXISTS (
      SELECT 1 FROM public.group_threads gt
      JOIN public.friend_group_members fm ON fm.group_id = gt.group_id AND fm.user_id = v_caller
      WHERE gt.thread_id = t.id
    );
  IF v_src.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_journal');
  END IF;

  FOREACH v_room IN ARRAY p_room_ids LOOP
    SELECT parent_group_id, show_id INTO v_parent, v_show
    FROM public.friend_groups
    WHERE id = v_room AND deleted_at IS NULL;
    IF v_parent IS NULL OR v_show IS NULL OR v_show <> v_src.show_id THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.people_group_members
      WHERE group_id = v_parent AND user_id = v_caller
    ) THEN
      CONTINUE;
    END IF;
    -- already there (sent or handed over)
    IF EXISTS (
      SELECT 1 FROM public.threads c
      JOIN public.group_threads gt2 ON gt2.thread_id = c.id AND gt2.group_id = v_room
      WHERE c.source_thread_id = v_src.id
    ) THEN
      CONTINUE;
    END IF;

    -- Sending puts you in the room, as the handover does.
    DELETE FROM public.friend_group_departed_members
    WHERE group_id = v_room AND user_id = v_caller;
    INSERT INTO public.friend_group_members (group_id, user_id)
    SELECT v_room, v_caller
    WHERE NOT EXISTS (
      SELECT 1 FROM public.friend_group_members WHERE group_id = v_room AND user_id = v_caller
    );
    INSERT INTO public.group_show_votes (group_id, user_id, show_id)
    VALUES (v_parent, v_caller, v_show)
    ON CONFLICT DO NOTHING;
    DELETE FROM public.group_show_passes
    WHERE group_id = v_parent AND user_id = v_caller AND show_id = v_show;

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
    VALUES (v_room, v_new_id, 'sent');
    v_sent := v_sent || v_room;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', COALESCE(array_length(v_sent, 1), 0), 'room_ids', to_jsonb(v_sent));
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_journal_entry(TEXT, UUID[]) TO authenticated;
