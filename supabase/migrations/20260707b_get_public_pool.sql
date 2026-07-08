-- ============================================================
-- 2026-07-07b — get_public_pool: the pool page + invite-arrival shelves
-- become OPT-IN-BASED (Alborz decision, mobile-mirror follow-up).
--
-- The two public surfaces (/pool/:username + the group-invite arrival, both
-- platforms) stop guessing from raw watch progress and instead list:
--   • bucket 'proposal' — "…is interested in starting these shows:" =
--     shows the target has a live yes-vote on in ANY group they're still a
--     member of (proposing = the proposer's yes). EXCLUDES shows already in
--     the 'room' bucket and shows the target deliberately LEFT a room for
--     (departed marker) — an exit shouldn't re-advertise interest. Watch
--     progress alone (e.g. "just confirm my progress") deliberately does
--     NOT surface a show here — consistent with the group-scoped model.
--   • bucket 'room' — "…is already watching these:" = shows with an OPEN
--     show room the target is a CURRENT member of (parent-grouped,
--     non-deleted, and not under a migration-dormant group membership).
--     Includes not-started room members (auto-opted invitees) by design.
--
-- Global watch progress rides along for the s/e labels (0/0 when no row).
-- SECURITY DEFINER because votes/memberships are group-private; this
-- exposes only (show, bucket, s, e) for one user — no group names, no
-- co-members, no counts. Callable logged-out (the invite arrival is anon).
-- Frontend is tolerant pre-migration (RPC missing → old progress-derived
-- shelves).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_public_pool(target_user_id uuid)
RETURNS TABLE (
  show_id text,
  bucket  text,   -- 'room' | 'proposal'
  season  int,
  episode int
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH room_shows AS (
    SELECT DISTINCT fg.show_id AS sid
    FROM public.friend_group_members fgm
    JOIN public.friend_groups fg
      ON fg.id = fgm.group_id
    JOIN public.people_group_members pgm
      ON pgm.group_id = fg.parent_group_id AND pgm.user_id = fgm.user_id
    WHERE fgm.user_id = target_user_id
      AND fg.parent_group_id IS NOT NULL
      AND fg.deleted_at IS NULL
      AND COALESCE(pgm.migration_dormant, false) = false
  ),
  left_shows AS (
    -- Rooms the target deliberately left (marker present, not re-joined).
    SELECT DISTINCT fg.show_id AS sid
    FROM public.friend_group_departed_members d
    JOIN public.friend_groups fg
      ON fg.id = d.group_id
    WHERE d.user_id = target_user_id
      AND fg.parent_group_id IS NOT NULL
      AND fg.deleted_at IS NULL
  ),
  proposal_shows AS (
    SELECT DISTINCT v.show_id AS sid
    FROM public.group_show_votes v
    JOIN public.people_groups pg
      ON pg.id = v.group_id
    JOIN public.people_group_members pgm
      ON pgm.group_id = v.group_id AND pgm.user_id = v.user_id
    WHERE v.user_id = target_user_id
      AND pg.deleted_at IS NULL
      AND COALESCE(pgm.migration_dormant, false) = false
      AND v.show_id NOT IN (SELECT rs.sid FROM room_shows rs)
      AND v.show_id NOT IN (SELECT ls.sid FROM left_shows ls)
  )
  SELECT r.sid, 'room'::text, COALESCE(p.season, 0), COALESCE(p.episode, 0)
  FROM room_shows r
  LEFT JOIN public.progress p
    ON p.user_id = target_user_id AND p.show_id = r.sid
  UNION ALL
  SELECT s.sid, 'proposal'::text, COALESCE(p.season, 0), COALESCE(p.episode, 0)
  FROM proposal_shows s
  LEFT JOIN public.progress p
    ON p.user_id = target_user_id AND p.show_id = s.sid;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_pool(uuid) TO anon, authenticated;
