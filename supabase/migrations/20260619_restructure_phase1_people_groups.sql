-- ============================================================
-- Restructure Phase 1 — People-groups + voting layer + (group × show) rooms
-- ============================================================
-- Foundation for the "groups + show rooms" restructure. ADDITIVE ONLY —
-- nothing existing is renamed, deleted, or rewritten. Safe to apply on the
-- live DB while the current app keeps running unchanged:
--   • Three brand-new tables (no data to migrate)
--   • One NULLABLE column added to friend_groups (existing rows untouched)
--   • RLS enabled with explicit member-only SELECT policies
--   • All writes go through SECURITY DEFINER RPCs (atomic by construction)
-- Idempotent. Re-applying is safe.
--
-- The model:
--   people_groups        — a group as just a set of PEOPLE, spanning shows
--   people_group_members — who is in the people-group
--   group_show_votes     — per (group, user, show) opt-in / "want to watch"
--   friend_groups.parent_group_id — links the EXISTING friend-room entity
--                          to a people-group, turning it into a (group×show)
--                          ROOM. A friend_groups row with parent_group_id set
--                          is a room; legacy standalone rooms keep it NULL.
--
-- Because a room is still a friend_groups row, every existing room feature
-- (writing, season map, dice ratings, pings, polls, SIKW, highlights) keeps
-- working unchanged — they are all already keyed to friend_groups.id.
-- ============================================================


-- ── people_groups ──────────────────────────────────────────────────────────
-- name is the CUSTOM name (shared across members). NULL = use the auto-name
-- derived from the other members' usernames (computed client-side).

CREATE TABLE IF NOT EXISTS public.people_groups (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,
  created_by  UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);


-- ── people_group_members ───────────────────────────────────────────────────
-- Active members of a people-group. Pending/invited state lives in the
-- existing invitations flow (wired in a later checkpoint), not here.

CREATE TABLE IF NOT EXISTS public.people_group_members (
  group_id   UUID         NOT NULL REFERENCES public.people_groups(id) ON DELETE CASCADE,
  user_id    UUID         NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS people_group_members_user_idx
  ON public.people_group_members (user_id);


-- ── group_show_votes ───────────────────────────────────────────────────────
-- A row's PRESENCE = this user has voted "yes / want to watch" for this show
-- inside this group. Un-voting deletes the row. (Whether the user is actually
-- WATCHING is read from the global progress table, not stored here.)
-- show_id is TEXT with no FK, matching the existing friend_groups.show_id and
-- progress.show_id convention.

CREATE TABLE IF NOT EXISTS public.group_show_votes (
  group_id    UUID         NOT NULL REFERENCES public.people_groups(id) ON DELETE CASCADE,
  user_id     UUID         NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  show_id     TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id, show_id)
);

CREATE INDEX IF NOT EXISTS group_show_votes_group_show_idx
  ON public.group_show_votes (group_id, show_id);


-- ── friend_groups.parent_group_id ──────────────────────────────────────────
-- Turns a friend_groups row into a (people-group × show) room. NULL on every
-- existing row (legacy standalone rooms / TSP), so this is a no-op for current
-- data and the current app.

ALTER TABLE public.friend_groups
  ADD COLUMN IF NOT EXISTS parent_group_id UUID
  REFERENCES public.people_groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS friend_groups_parent_show_idx
  ON public.friend_groups (parent_group_id, show_id);


-- ── RLS ────────────────────────────────────────────────────────────────────
-- SELECT: members of the people-group can read the group, its membership, and
-- its votes (needed for pill counts). All writes go through the RPCs below, so
-- there are deliberately NO insert/update/delete policies.

ALTER TABLE public.people_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS people_groups_select_member ON public.people_groups;
CREATE POLICY people_groups_select_member
  ON public.people_groups
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.people_group_members m
      WHERE m.group_id = people_groups.id AND m.user_id = auth.uid()
    )
  );

ALTER TABLE public.people_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS people_group_members_select_member ON public.people_group_members;
CREATE POLICY people_group_members_select_member
  ON public.people_group_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.people_group_members m2
      WHERE m2.group_id = people_group_members.group_id AND m2.user_id = auth.uid()
    )
  );

ALTER TABLE public.group_show_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_show_votes_select_member ON public.group_show_votes;
CREATE POLICY group_show_votes_select_member
  ON public.group_show_votes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.people_group_members m
      WHERE m.group_id = group_show_votes.group_id AND m.user_id = auth.uid()
    )
  );


-- ── RPC: create_people_group ───────────────────────────────────────────────
-- Atomically creates a people-group and adds the caller as its first member.
-- (Fixes the non-atomic two-insert pattern the legacy createFriendGroup used.)
-- p_name is the optional custom name; blank/NULL → group uses its auto-name.
-- Returns: jsonb { ok, error?, group_id? }

CREATE OR REPLACE FUNCTION public.create_people_group(p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller    UUID;
  v_group_id  UUID;
  v_name      TEXT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  v_name := NULLIF(trim(COALESCE(p_name, '')), '');
  IF v_name IS NOT NULL AND length(v_name) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name_too_long');
  END IF;

  INSERT INTO public.people_groups (name, created_by)
  VALUES (v_name, v_caller)
  RETURNING id INTO v_group_id;

  INSERT INTO public.people_group_members (group_id, user_id)
  VALUES (v_group_id, v_caller);

  RETURN jsonb_build_object('ok', true, 'group_id', v_group_id);
END;
$$;


-- ── RPC: set_show_vote ─────────────────────────────────────────────────────
-- Toggle the caller's per-group opt-in for a show. p_voted=true inserts the
-- vote (idempotent), false removes it. Membership-gated.
-- Returns: jsonb { ok, error?, voted? }

CREATE OR REPLACE FUNCTION public.set_show_vote(
  p_group_id  UUID,
  p_show_id   TEXT,
  p_voted     BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.people_group_members
    WHERE group_id = p_group_id AND user_id = v_caller
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  IF p_show_id IS NULL OR length(trim(p_show_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'show_required');
  END IF;

  IF p_voted THEN
    INSERT INTO public.group_show_votes (group_id, user_id, show_id)
    VALUES (p_group_id, v_caller, p_show_id)
    ON CONFLICT (group_id, user_id, show_id) DO NOTHING;
  ELSE
    DELETE FROM public.group_show_votes
    WHERE group_id = p_group_id AND user_id = v_caller AND show_id = p_show_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'voted', p_voted);
END;
$$;


-- ── RPC: start_show_room ───────────────────────────────────────────────────
-- Creates the one (people-group × show) room if none exists, else returns the
-- existing room ("Start a show room?" vs "Open show room"). A room is a
-- friend_groups row with parent_group_id set.
--
-- On first creation, auto-enrolls every currently-opted-in member of the
-- people-group — anyone who voted for this show in this group OR is already
-- watching it (has a progress row) — plus the caller. Enrollment is scoped to
-- THIS group only; it never fans out to the user's other groups.
--
-- friend_groups.name is set to the show id: it is a guaranteed-non-empty,
-- never-displayed value (the people-group carries the room's display name),
-- which avoids any NOT NULL / CHECK constraint risk on the legacy column.
--
-- Returns: jsonb { ok, error?, room_id?, created? }

CREATE OR REPLACE FUNCTION public.start_show_room(
  p_group_id  UUID,
  p_show_id   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_room_id  UUID;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.people_group_members
    WHERE group_id = p_group_id AND user_id = v_caller
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  IF p_show_id IS NULL OR length(trim(p_show_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'show_required');
  END IF;

  -- Existing room for this (group, show)?
  SELECT id INTO v_room_id
  FROM public.friend_groups
  WHERE parent_group_id = p_group_id
    AND show_id = p_show_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'room_id', v_room_id, 'created', false);
  END IF;

  -- Create the room (a parented friend_groups row).
  INSERT INTO public.friend_groups (show_id, name, created_by, parent_group_id)
  VALUES (p_show_id, p_show_id, v_caller, p_group_id)
  RETURNING id INTO v_room_id;

  -- Auto-enroll opted-in members of THIS group: voters OR watchers, plus the
  -- caller. NOT EXISTS guard keeps it safe regardless of friend_group_members
  -- constraints.
  INSERT INTO public.friend_group_members (group_id, user_id)
  SELECT v_room_id, u.user_id
  FROM (
    SELECT v_caller AS user_id
    UNION
    SELECT gsv.user_id
      FROM public.group_show_votes gsv
      WHERE gsv.group_id = p_group_id AND gsv.show_id = p_show_id
    UNION
    SELECT pgm.user_id
      FROM public.people_group_members pgm
      JOIN public.progress pr
        ON pr.user_id = pgm.user_id AND pr.show_id = p_show_id
      WHERE pgm.group_id = p_group_id
  ) AS u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.friend_group_members fgm
    WHERE fgm.group_id = v_room_id AND fgm.user_id = u.user_id
  );

  RETURN jsonb_build_object('ok', true, 'room_id', v_room_id, 'created', true);
END;
$$;


-- ── execute permissions ────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.create_people_group(TEXT)              FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_people_group(TEXT)          TO authenticated;

REVOKE ALL ON FUNCTION public.set_show_vote(UUID, TEXT, BOOLEAN)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_show_vote(UUID, TEXT, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.start_show_room(UUID, TEXT)            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_show_room(UUID, TEXT)        TO authenticated;
