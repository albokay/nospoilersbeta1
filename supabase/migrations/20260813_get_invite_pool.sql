-- ============================================================
-- 2026-08-13 — get_invite_pool: GROUP-scoped invite-arrival shelves.
--
-- The invite walls used get_public_pool (the inviter's CROSS-GROUP pool),
-- so an invitee saw every show the inviter had opted into anywhere. This
-- token-gated variant returns only the inviter's engagement WITHIN the
-- invited group (Alborz's call, 2026-08-13):
--   • bucket 'room'     — THIS group's open show rooms the inviter is a
--                         current member of
--   • bucket 'proposal' — the inviter's live yes-votes in THIS group
--                         (minus roomed shows and rooms they left — an
--                         exit shouldn't re-advertise interest, matching
--                         get_public_pool)
-- Season/episode = the inviter's global progress, for the shelf labels.
--
-- Token-gated + anon-callable: holding the invite link IS the permission
-- (same trust model as get_people_group_invitation), and nothing beyond
-- show ids + the inviter's progress on them is exposed — no group names,
-- co-members, or counts. An unknown/withdrawn token, or an inviter no
-- longer in the group, returns zero rows (the frontend then falls back).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_invite_pool(invite_token text)
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
  WITH inv AS (
    -- The invite's group + inviter; requires the inviter to still be a
    -- member of that group (else: zero rows).
    SELECT i.people_group_id AS gid, i.created_by AS inviter
    FROM public.people_group_invitations i
    JOIN public.people_group_members pgm
      ON pgm.group_id = i.people_group_id AND pgm.user_id = i.created_by
    WHERE i.token = invite_token
  ),
  room_shows AS (
    -- THIS group's open rooms the inviter currently belongs to.
    SELECT DISTINCT fg.show_id AS sid
    FROM inv
    JOIN public.friend_groups fg
      ON fg.parent_group_id = inv.gid AND fg.deleted_at IS NULL
    JOIN public.friend_group_members fgm
      ON fgm.group_id = fg.id AND fgm.user_id = inv.inviter
  ),
  left_shows AS (
    -- THIS group's rooms the inviter deliberately left.
    SELECT DISTINCT fg.show_id AS sid
    FROM inv
    JOIN public.friend_groups fg
      ON fg.parent_group_id = inv.gid AND fg.deleted_at IS NULL
    JOIN public.friend_group_departed_members d
      ON d.group_id = fg.id AND d.user_id = inv.inviter
  ),
  proposal_shows AS (
    -- The inviter's live yes-votes in THIS group (vote-row presence = yes).
    SELECT DISTINCT v.show_id AS sid
    FROM inv
    JOIN public.group_show_votes v
      ON v.group_id = inv.gid AND v.user_id = inv.inviter
    WHERE v.show_id NOT IN (SELECT rs.sid FROM room_shows rs)
      AND v.show_id NOT IN (SELECT ls.sid FROM left_shows ls)
  )
  SELECT r.sid, 'room'::text, COALESCE(p.season, 0), COALESCE(p.episode, 0)
  FROM room_shows r
  CROSS JOIN inv
  LEFT JOIN public.progress p
    ON p.user_id = inv.inviter AND p.show_id = r.sid
  UNION ALL
  SELECT s.sid, 'proposal'::text, COALESCE(p.season, 0), COALESCE(p.episode, 0)
  FROM proposal_shows s
  CROSS JOIN inv
  LEFT JOIN public.progress p
    ON p.user_id = inv.inviter AND p.show_id = s.sid;
$$;

GRANT EXECUTE ON FUNCTION public.get_invite_pool(text) TO anon, authenticated;
