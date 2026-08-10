-- ============================================================
-- Answer-to-reveal (spec docs/swipe-deck/answer-to-reveal-spec.md, 2026-08-01)
-- ============================================================
-- A friend's deck answer is HIDDEN until the caller has answered that
-- question themselves. Server-side, matching the site's spoiler precedent
-- (gated entries return stubs, not bodies): for cards the caller hasn't
-- answered, other members' rows come back with answer = NULL — row
-- presence kept, that's the covered-"?" cell. The caller's own rows are
-- always full. Frontend (deployed either side of this — tolerant): NULL
-- renders covered; the findings engine skips NULLs and scopes itself to
-- caller-answered cards. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_group_deck_answers(p_group_id UUID)
RETURNS TABLE (user_id uuid, card_id text, answer boolean, answered_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.user_id,
    a.card_id,
    -- Reveal gate: your own answers, and friends' answers on cards you've
    -- answered too. Everything else masks to NULL (the covered cell).
    CASE
      WHEN a.user_id = auth.uid() THEN a.answer
      WHEN EXISTS (
        SELECT 1 FROM public.deck_answers mine
        WHERE mine.user_id = auth.uid() AND mine.card_id = a.card_id
      ) THEN a.answer
      ELSE NULL
    END AS answer,
    a.updated_at
  FROM public.deck_answers a
  JOIN public.people_group_members m
    ON m.user_id = a.user_id AND m.group_id = p_group_id
  JOIN public.deck_cards c ON c.id = a.card_id
  WHERE c.is_active
    AND c.released_at <= now()
    AND EXISTS (
      SELECT 1 FROM public.people_group_members me
      WHERE me.group_id = p_group_id AND me.user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.get_group_deck_answers(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_deck_answers(UUID) TO authenticated;
