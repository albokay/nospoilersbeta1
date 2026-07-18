-- ============================================================================
-- SWIPE DECK — card catalog + per-user answers + group read (CP1 of the
-- swipe-deck arc; spec ~/Downloads/sidebar_swipe_deck_spec.md)
-- ============================================================================
-- Product model:
--   • deck_cards is the admin-authored catalog of agree/disagree statements
--     ("How I/We Watch TV"). Everyone reads released cards; only the admin
--     writes (prompts-table precedent). Content rows arrive via a separate
--     paste-ready seed (docs/swipe-deck/deck_cards_seed_DRAFT.sql) — NOT in
--     this migration, per the onboarding-prompts precedent.
--   • deck_answers stores one row per (user, card): a global yes/no. Global,
--     not per-group — the same answer feeds every group's grid. Structural
--     clone of episode_ratings: owner-only RLS on all four verbs, surrogate
--     uuid PK + UNIQUE, updated_at touch trigger, direct client upserts.
--   • Cross-member reads go EXCLUSIVELY through get_group_deck_answers
--     (SECURITY DEFINER, gated on people-group membership) — the
--     get_room_map_data pattern. Returns only current members' answers to
--     released, active cards. Non-members get zero rows.
--   • Drip = released_at <= now(). One global calendar; no scheduler.
--     wave 1/2 mark the fixed onboarding 8; NULL wave = drip card.
-- Conventions: SET search_path pinned everywhere (§6 item 21); paired
-- REVOKE/GRANT on the RPC; idempotent DDL.
-- ============================================================================

-- ── 1. The card catalog ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deck_cards (
  id          text PRIMARY KEY,
  statement   text NOT NULL,
  singular    text NOT NULL,
  plural      text NOT NULL,
  cold        text,
  axis_x      smallint NOT NULL DEFAULT 0 CHECK (axis_x BETWEEN -1 AND 1),
  axis_y      smallint NOT NULL DEFAULT 0 CHECK (axis_y BETWEEN -1 AND 1),
  card_type   text NOT NULL CHECK (card_type IN ('split','confession','consensus')),
  wave        smallint CHECK (wave IN (1,2)),
  released_at timestamptz NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deck_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deck_cards_select ON public.deck_cards;
DROP POLICY IF EXISTS deck_cards_insert ON public.deck_cards;
DROP POLICY IF EXISTS deck_cards_update ON public.deck_cards;
DROP POLICY IF EXISTS deck_cards_delete ON public.deck_cards;

-- Released + active cards are readable by everyone (the statements are part
-- of the UI, like prompts); unreleased/retired cards stay admin-only so the
-- drip can't be read ahead via REST.
CREATE POLICY deck_cards_select
  ON public.deck_cards
  FOR SELECT
  USING (public.is_admin() OR (is_active AND released_at <= now()));

CREATE POLICY deck_cards_insert
  ON public.deck_cards
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY deck_cards_update
  ON public.deck_cards
  FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY deck_cards_delete
  ON public.deck_cards
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ── 2. Per-user answers ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deck_answers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id    text NOT NULL REFERENCES public.deck_cards(id) ON DELETE CASCADE,
  answer     boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_deck_answers_user
  ON public.deck_answers (user_id);

CREATE OR REPLACE FUNCTION public.touch_deck_answers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_deck_answers_touch_updated_at ON public.deck_answers;
CREATE TRIGGER trg_deck_answers_touch_updated_at
  BEFORE UPDATE ON public.deck_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_deck_answers_updated_at();

ALTER TABLE public.deck_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deck_answers_select ON public.deck_answers;
DROP POLICY IF EXISTS deck_answers_insert ON public.deck_answers;
DROP POLICY IF EXISTS deck_answers_update ON public.deck_answers;
DROP POLICY IF EXISTS deck_answers_delete ON public.deck_answers;

CREATE POLICY deck_answers_select
  ON public.deck_answers
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY deck_answers_insert
  ON public.deck_answers
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY deck_answers_update
  ON public.deck_answers
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY deck_answers_delete
  ON public.deck_answers
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ── 3. The group read (the ONLY cross-user path) ────────────────────────────

CREATE OR REPLACE FUNCTION public.get_group_deck_answers(p_group_id UUID)
RETURNS TABLE (user_id uuid, card_id text, answer boolean, answered_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.user_id, a.card_id, a.answer, a.updated_at
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
