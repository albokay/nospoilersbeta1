-- 2026-10-07 — Highlight notes grow up (letters-only rooms arc, checkpoint 1).
--
-- (a) A note may run to 1,000 characters (was 50): notes stand in for
--     responses in rooms that have none.
-- (b) Highlights may OVERLAP: several people can note the same stretch of a
--     letter, and "Add note" on an open note writes a second note onto the
--     same stretch. create_highlight loses its overlap check; every other
--     check (signed in, member, target in the room) is unchanged, and the
--     signature is the same, so CREATE OR REPLACE is enough.
--
-- Paste the whole file into the SQL editor. Safe to re-run.

ALTER TABLE public.highlights DROP CONSTRAINT IF EXISTS highlights_kind_note_shape;
ALTER TABLE public.highlights ADD CONSTRAINT highlights_kind_note_shape
  CHECK (
    (kind = 'yup'  AND note IS NULL)
    OR
    (kind = 'note' AND note IS NOT NULL AND char_length(note) BETWEEN 1 AND 1000)
  );

CREATE OR REPLACE FUNCTION public.create_highlight(
  p_target_type    TEXT,
  p_target_id      TEXT,
  p_group_id       UUID,
  p_start_offset   INTEGER,
  p_end_offset     INTEGER,
  p_quoted_text    TEXT,
  p_kind           TEXT,
  p_note           TEXT,
  p_author_season  INTEGER,
  p_author_episode INTEGER
)
RETURNS public.highlights
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid       UUID := auth.uid();
  v_target_ok BOOLEAN := false;
  v_inserted  public.highlights;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.friend_group_members fgm
    WHERE fgm.group_id = p_group_id
      AND fgm.user_id  = v_uid
  ) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  IF p_target_type = 'thread' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.group_threads gt
      JOIN public.threads t ON t.id = gt.thread_id
      WHERE gt.group_id  = p_group_id
        AND gt.thread_id = p_target_id
        AND COALESCE(t.is_deleted, false) = false
    ) INTO v_target_ok;
  ELSIF p_target_type = 'reply' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.replies r
      WHERE r.id        = p_target_id
        AND r.group_id  = p_group_id
        AND COALESCE(r.is_deleted, false) = false
    ) INTO v_target_ok;
  ELSE
    RAISE EXCEPTION 'invalid_target_type';
  END IF;

  IF NOT v_target_ok THEN
    RAISE EXCEPTION 'target_not_in_group';
  END IF;

  -- (No overlap check: notes may stack on one stretch — 2026-10-07.)

  INSERT INTO public.highlights (
    target_type, target_id, group_id, author_id,
    start_offset, end_offset, quoted_text, kind, note,
    author_season, author_episode
  ) VALUES (
    p_target_type, p_target_id, p_group_id, v_uid,
    p_start_offset, p_end_offset, p_quoted_text, p_kind, p_note,
    p_author_season, p_author_episode
  )
  RETURNING * INTO v_inserted;

  RETURN v_inserted;
END $$;

GRANT EXECUTE ON FUNCTION public.create_highlight(
  TEXT, TEXT, UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;
