-- ============================================================
-- 2026-05-27 — Highlights phase 1c: spoiler filter via author snapshot
-- ============================================================
-- Adds `author_season` + `author_episode` to the highlights table — the
-- AUTHOR's effective progress at the moment they created the highlight.
-- This is the spoiler tag: a viewer must be at-or-past these coords to
-- see the highlight (parallel to how threads.season/episode + canView
-- gate visibility of posts).
--
-- Why snapshot at create time (not current author progress):
--   - A highlight's note reflects what the author KNEW at write time.
--   - Filtering against current author progress would over-filter: an
--     author who later advances would have their old (then-non-spoiler)
--     highlights hidden from people still behind them.
--   - Matches the established Sidebar pattern (threads/replies).
--
-- Backfill strategy for the (small) handful of existing highlight rows:
--   - thread targets → use threads.season/episode
--   - reply targets  → use replies.season/episode
--   - orphan rows (target deleted) → fall back to (0,0); canView returns
--     true for viewers at S>=1, so existing highlights remain visible
--     even after backfill — conservative.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + WHERE author_season IS NULL on
-- the backfill UPDATEs. Re-running is safe.
-- ============================================================


-- ── New columns (nullable during backfill) ──────────────────────────────
ALTER TABLE public.highlights
  ADD COLUMN IF NOT EXISTS author_season  INTEGER,
  ADD COLUMN IF NOT EXISTS author_episode INTEGER;


-- ── Backfill: thread-target highlights ──────────────────────────────────
UPDATE public.highlights h
   SET author_season  = COALESCE(t.season,  0),
       author_episode = COALESCE(t.episode, 0)
  FROM public.threads t
 WHERE h.target_type   = 'thread'
   AND h.target_id     = t.id
   AND h.author_season IS NULL;


-- ── Backfill: reply-target highlights ───────────────────────────────────
UPDATE public.highlights h
   SET author_season  = COALESCE(r.season,  0),
       author_episode = COALESCE(r.episode, 0)
  FROM public.replies r
 WHERE h.target_type   = 'reply'
   AND h.target_id     = r.id
   AND h.author_season IS NULL;


-- ── Backfill: any orphans (target row missing) get (0,0) ───────────────
-- canView returns true for viewers at S>=1, so these orphan highlights
-- stay visible everywhere — conservative compared to hiding them entirely.
UPDATE public.highlights
   SET author_season = 0, author_episode = 0
 WHERE author_season  IS NULL
    OR author_episode IS NULL;


-- ── Lock columns down ───────────────────────────────────────────────────
ALTER TABLE public.highlights
  ALTER COLUMN author_season  SET NOT NULL,
  ALTER COLUMN author_episode SET NOT NULL;

ALTER TABLE public.highlights
  ADD CONSTRAINT highlights_author_season_nonneg  CHECK (author_season  >= 0),
  ADD CONSTRAINT highlights_author_episode_nonneg CHECK (author_episode >= 0);


-- ── Update create_highlight RPC to accept + store the snapshot ─────────
-- Signature change (two new required params) requires DROP first; CREATE
-- OR REPLACE rejects parameter-list changes. The new client (C9) will be
-- deployed in the same arc; no callers of the old signature remain.

DROP FUNCTION IF EXISTS public.create_highlight(
  TEXT, TEXT, UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT
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

  IF EXISTS (
    SELECT 1
    FROM public.highlights h
    WHERE h.target_type = p_target_type
      AND h.target_id   = p_target_id
      AND h.start_offset < p_end_offset
      AND p_start_offset < h.end_offset
  ) THEN
    RAISE EXCEPTION 'overlap';
  END IF;

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
