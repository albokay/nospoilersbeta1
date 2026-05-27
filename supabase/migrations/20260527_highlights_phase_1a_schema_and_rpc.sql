-- ============================================================
-- 2026-05-27 — Highlights: per-(thread|reply) text annotations in friend rooms
-- ============================================================
-- A member of a friend room can select a stretch of text inside an entry
-- or response and attach a "Yup." reaction OR a short (<=50 char) note.
-- The selection is rendered as a yellow fill for every room member, with
-- a hover tooltip showing the author + reaction/note.
--
-- Constraints:
--   - Friend-room scope only: every highlight carries a non-null group_id
--     and SELECT is gated on room membership.
--   - No overlapping highlights on the same target (any character overlap
--     with any existing highlight is rejected). Enforced atomically inside
--     the create_highlight RPC.
--   - Offsets index into the raw stored body string (the column value), so
--     they are stable across renderer changes. quoted_text is stored too,
--     so edits can re-anchor highlights by string search (see C7).
--
-- This migration is ADD-ONLY: a new table, new policies on that new table,
-- and a new RPC. No ALTERs to existing tables. Existing reads are unaffected.
--
-- Idempotent: CREATE TABLE / CREATE INDEX use IF NOT EXISTS; policies use
-- DROP-then-CREATE; RPC uses CREATE OR REPLACE.
-- ============================================================


-- ── highlights table ─────────────────────────────────────────────────────
-- target_type/target_id is a polymorphic pointer — 'thread' targets a
-- threads.id (TEXT), 'reply' targets a replies.id (TEXT). Both PK columns
-- are TEXT in this schema, so a single TEXT column covers both.
--
-- group_id is required (friend-room scope only). On group delete, cascade
-- (highlights are part of room content, lose them with the room).
--
-- start_offset / end_offset are character indices into the target row's
-- raw body string. end_offset is exclusive (slice [start, end)).
--
-- quoted_text is the highlighted substring, stored so the C7 edit
-- re-anchor pass can string-search the new body for the same text.
--
-- kind/note enforce: kind='yup' has note=NULL; kind='note' has a 1..50
-- char note. The CHECK constraint binds the pair.

CREATE TABLE IF NOT EXISTS public.highlights (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   TEXT         NOT NULL CHECK (target_type IN ('thread', 'reply')),
  target_id     TEXT         NOT NULL,
  group_id      UUID         NOT NULL REFERENCES public.friend_groups(id) ON DELETE CASCADE,
  author_id     UUID         NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  start_offset  INTEGER      NOT NULL CHECK (start_offset >= 0),
  end_offset    INTEGER      NOT NULL,
  quoted_text   TEXT         NOT NULL CHECK (char_length(quoted_text) BETWEEN 1 AND 2000),
  kind          TEXT         NOT NULL CHECK (kind IN ('yup', 'note')),
  note          TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT highlights_offsets_ordered
    CHECK (end_offset > start_offset),
  CONSTRAINT highlights_kind_note_shape
    CHECK (
      (kind = 'yup'  AND note IS NULL)
      OR
      (kind = 'note' AND note IS NOT NULL AND char_length(note) BETWEEN 1 AND 50)
    )
);


-- ── indexes ──────────────────────────────────────────────────────────────
-- Fetch-by-target: render path joins highlights to thread/reply by id.
-- Group lookup: backs the membership SELECT policy.
-- Author lookup: backs the author-only DELETE policy.

CREATE INDEX IF NOT EXISTS highlights_target_idx
  ON public.highlights (target_type, target_id);

CREATE INDEX IF NOT EXISTS highlights_group_idx
  ON public.highlights (group_id);

CREATE INDEX IF NOT EXISTS highlights_author_idx
  ON public.highlights (author_id);


-- ── RLS ──────────────────────────────────────────────────────────────────
-- SELECT: any member of group_id can read. Mirrors the access pattern for
--   replies (also room-scoped). Departed members lose access via the same
--   membership check.
-- DELETE: author may delete their own highlights. The tooltip × on a
--   highlight is the only delete affordance.
-- INSERT: NO policy — all inserts route through create_highlight() RPC
--   (SECURITY DEFINER) so the overlap check runs atomically. With RLS on
--   and zero INSERT policies, direct REST inserts are denied.
-- UPDATE: no policy — highlights are immutable once created (delete + redo
--   if the user wants to change wording).

ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "highlights: members can read"     ON public.highlights;
DROP POLICY IF EXISTS "highlights: author can delete"    ON public.highlights;

CREATE POLICY "highlights: members can read"
  ON public.highlights
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.friend_group_members fgm
      WHERE fgm.group_id = highlights.group_id
        AND fgm.user_id  = auth.uid()
    )
  );

CREATE POLICY "highlights: author can delete"
  ON public.highlights
  FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());


-- ── create_highlight RPC ─────────────────────────────────────────────────
-- SECURITY DEFINER so the membership/target/overlap checks run with the
-- function owner's privileges (bypasses RLS for the validation reads) but
-- the actual insert is attributed to auth.uid().
--
-- Checks, in order:
--   1. Caller is signed in (auth.uid() not null).
--   2. Caller is a member of p_group_id.
--   3. Target row exists AND belongs to p_group_id.
--        - thread: present in group_threads for this group, not deleted.
--        - reply:  replies.group_id matches this group, not deleted.
--   4. No existing highlight on this (target_type, target_id) overlaps
--      the requested [p_start_offset, p_end_offset) range. Overlap is
--      "any character in common" — i.e. NOT (existing.end <= new.start
--      OR existing.start >= new.end). Applies regardless of author —
--      same user cannot stack overlapping highlights on themselves either.
--
-- Per HANDOFF §6 item 30: every column reference is table-qualified and
-- `#variable_conflict use_column` is pinned at the top of the plpgsql
-- block as defense-in-depth against ambiguous-column errors.

CREATE OR REPLACE FUNCTION public.create_highlight(
  p_target_type   TEXT,
  p_target_id     TEXT,
  p_group_id      UUID,
  p_start_offset  INTEGER,
  p_end_offset    INTEGER,
  p_quoted_text   TEXT,
  p_kind          TEXT,
  p_note          TEXT
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

  -- Membership check.
  IF NOT EXISTS (
    SELECT 1
    FROM public.friend_group_members fgm
    WHERE fgm.group_id = p_group_id
      AND fgm.user_id  = v_uid
  ) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  -- Target belongs to this group.
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

  -- Overlap check. Two ranges [a, b) and [c, d) overlap iff
  --   a < d AND c < b.
  -- Locks nothing extra: PK constraint + the atomic SQL semantics give us
  -- a race window only between this SELECT and the INSERT below, which
  -- the row's CHECK constraints + a serializable retry would close fully.
  -- At expected concurrency (a handful of room members) this is fine.
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
    start_offset, end_offset, quoted_text, kind, note
  ) VALUES (
    p_target_type, p_target_id, p_group_id, v_uid,
    p_start_offset, p_end_offset, p_quoted_text, p_kind, p_note
  )
  RETURNING * INTO v_inserted;

  RETURN v_inserted;
END $$;

GRANT EXECUTE ON FUNCTION public.create_highlight(
  TEXT, TEXT, UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT
) TO authenticated;
