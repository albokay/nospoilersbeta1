-- ============================================================
-- 2026-05-27 — Highlights phase 1b: edit re-anchor RPC
-- ============================================================
-- When a thread or reply body is edited, the previously-stored highlight
-- offsets may no longer line up with their original text. This RPC walks
-- every highlight on a target after edit, finds the highlight's saved
-- quoted_text in the NEW body via string search, and either:
--   - updates start_offset/end_offset to the match closest to the old
--     start (preserves position-of-intent when text appears in multiple
--     places), or
--   - deletes the highlight if its quoted_text no longer appears in the
--     body at all (per Q4 best-effort-reanchor semantics).
--
-- SECURITY DEFINER is required because the RPC needs to UPDATE and DELETE
-- rows authored by OTHER users (the target's author isn't necessarily the
-- highlight's author). The base highlights RLS allows DELETE only to the
-- highlight's own author. Inside this function, RLS is bypassed; the
-- caller must be the TARGET's author (authz gate at top of function).
--
-- Idempotent: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reanchor_highlights_for_target(
  p_target_type TEXT,
  p_target_id   TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid           UUID := auth.uid();
  v_body          TEXT;
  v_author        UUID;
  h               RECORD;
  v_search_cursor INTEGER;
  v_idx           INTEGER;
  v_abs_pos       INTEGER;
  v_dist          INTEGER;
  v_best_idx      INTEGER;
  v_best_dist     INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Load target body + verify caller is the author.
  IF p_target_type = 'thread' THEN
    SELECT t.body, t.author_id INTO v_body, v_author
    FROM public.threads t
    WHERE t.id = p_target_id;
  ELSIF p_target_type = 'reply' THEN
    SELECT r.body, r.author_id INTO v_body, v_author
    FROM public.replies r
    WHERE r.id = p_target_id;
  ELSE
    RAISE EXCEPTION 'invalid_target_type';
  END IF;

  -- Target may legitimately not exist (e.g. called on a deleted thread after
  -- a race) — exit quietly rather than raising. Callers don't care, and
  -- highlights cascade-deleted with the target anyway via FK ON DELETE.
  IF v_body IS NULL THEN
    RETURN;
  END IF;

  -- Only the target's author may re-anchor. Anyone else calling this
  -- silently is a misuse; raise to surface the bug.
  IF v_author <> v_uid THEN
    RAISE EXCEPTION 'not_author';
  END IF;

  -- Walk every highlight on this target. For each, scan v_body for ALL
  -- occurrences of quoted_text and pick the offset closest to the old
  -- start_offset. POSITION returns 1-based positions; we convert to
  -- 0-based for storage to match the rest of the offset model.
  FOR h IN
    SELECT id, start_offset, quoted_text
    FROM public.highlights
    WHERE target_type = p_target_type
      AND target_id   = p_target_id
  LOOP
    v_best_idx  := -1;
    v_best_dist := NULL;
    v_search_cursor := 0;  -- 0-based offset into v_body to start from

    LOOP
      -- POSITION on a substring starting at v_search_cursor (1-based for
      -- substring's FROM arg, so +1).
      v_idx := POSITION(h.quoted_text IN substring(v_body FROM v_search_cursor + 1));
      EXIT WHEN v_idx = 0;

      -- Convert 1-based position within the substring to absolute 0-based.
      v_abs_pos := v_search_cursor + v_idx - 1;
      v_dist    := abs(v_abs_pos - h.start_offset);

      IF v_best_dist IS NULL OR v_dist < v_best_dist THEN
        v_best_idx  := v_abs_pos;
        v_best_dist := v_dist;
      END IF;

      -- Advance past the START of this match (allows discovering
      -- overlapping matches, which is rare but correct).
      v_search_cursor := v_search_cursor + v_idx;
    END LOOP;

    IF v_best_idx = -1 THEN
      -- Text not found anywhere in the new body — drop the highlight.
      DELETE FROM public.highlights WHERE id = h.id;
    ELSE
      -- Best-match position found; update offsets to anchor there.
      UPDATE public.highlights
      SET start_offset = v_best_idx,
          end_offset   = v_best_idx + char_length(h.quoted_text)
      WHERE id = h.id;
    END IF;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.reanchor_highlights_for_target(TEXT, TEXT) TO authenticated;
