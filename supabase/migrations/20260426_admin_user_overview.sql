-- Admin: per-user overview + drill-down activity log.
-- Two SECURITY DEFINER RPCs gated on public.is_admin(). Read-only.
-- No schema changes. Surfaces auth.users.email + last_sign_in_at to admins
-- only via the function — RLS still hides auth.users from regular clients.
--
-- Performance notes:
--   - tsp_groups + tsp_thread_ids are pre-aggregated CTEs so per-thread
--     TSP lookup is a hash join rather than an EXISTS subquery on each row.
--     Linear in thread count at any scale.
--   - The user_co_members self-join is the most expensive piece; relies on
--     existing indexes on friend_group_members(group_id, user_id). Fine at
--     beta scale (5–10 users); revisit if it stalls at 1000+.
--   - Excludes is_seed=true profiles (fictional users from mockData.ts).

CREATE OR REPLACE FUNCTION public.get_admin_user_overview()
RETURNS TABLE (
  user_id              uuid,
  username             text,
  email                text,
  signup_at            timestamptz,
  last_sign_in_at      timestamptz,
  rooms_count          integer,
  distinct_co_members  integer,
  invites_sent         integer,
  threads_count        integer,
  replies_count        integer,
  threads_count_tsp    integer,
  replies_count_tsp    integer,
  last_activity_at     timestamptz,
  posts_per_week       numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  WITH
    tsp_groups AS (
      SELECT id FROM friend_groups WHERE show_id = 'tsp'
    ),
    tsp_thread_ids AS (
      SELECT DISTINCT gt.thread_id
      FROM group_threads gt
      WHERE gt.group_id IN (SELECT id FROM tsp_groups)
    ),
    user_threads AS (
      SELECT
        t.author_id,
        COUNT(*) FILTER (WHERE tt.thread_id IS NULL)     AS real_threads,
        COUNT(*) FILTER (WHERE tt.thread_id IS NOT NULL) AS tsp_threads,
        MAX(t.updated_at)                                AS last_thread_at
      FROM threads t
      LEFT JOIN tsp_thread_ids tt ON tt.thread_id = t.id
      WHERE COALESCE(t.is_deleted, false) = false
      GROUP BY t.author_id
    ),
    user_replies AS (
      SELECT
        r.author_id,
        COUNT(*) FILTER (
          WHERE r.group_id IS NULL
             OR r.group_id NOT IN (SELECT id FROM tsp_groups)
        ) AS real_replies,
        COUNT(*) FILTER (
          WHERE r.group_id IN (SELECT id FROM tsp_groups)
        ) AS tsp_replies,
        MAX(r.updated_at) AS last_reply_at
      FROM replies r
      WHERE COALESCE(r.is_deleted, false) = false
      GROUP BY r.author_id
    ),
    user_rooms AS (
      SELECT fgm.user_id, COUNT(*)::integer AS room_count
      FROM friend_group_members fgm
      JOIN friend_groups fg ON fg.id = fgm.group_id
      WHERE fg.deleted_at IS NULL
      GROUP BY fgm.user_id
    ),
    user_co_members AS (
      SELECT m1.user_id, COUNT(DISTINCT m2.user_id)::integer AS co_count
      FROM friend_group_members m1
      JOIN friend_group_members m2 ON m1.group_id = m2.group_id
      JOIN friend_groups fg ON fg.id = m1.group_id
      WHERE m2.user_id != m1.user_id
        AND fg.deleted_at IS NULL
      GROUP BY m1.user_id
    ),
    user_invites AS (
      SELECT created_by, COUNT(*)::integer AS sent_count
      FROM invitations
      GROUP BY created_by
    )
  SELECT
    p.id::uuid                                            AS user_id,
    p.username,
    au.email::text                                        AS email,
    p.created_at                                          AS signup_at,
    au.last_sign_in_at,
    COALESCE(ur.room_count, 0)                            AS rooms_count,
    COALESCE(ucm.co_count, 0)                             AS distinct_co_members,
    COALESCE(ui.sent_count, 0)                            AS invites_sent,
    COALESCE(ut.real_threads, 0)::integer                 AS threads_count,
    COALESCE(urep.real_replies, 0)::integer               AS replies_count,
    COALESCE(ut.tsp_threads, 0)::integer                  AS threads_count_tsp,
    COALESCE(urep.tsp_replies, 0)::integer                AS replies_count_tsp,
    GREATEST(ut.last_thread_at, urep.last_reply_at)       AS last_activity_at,
    ROUND(
      ((COALESCE(ut.real_threads, 0) + COALESCE(urep.real_replies, 0)
        + COALESCE(ut.tsp_threads, 0) + COALESCE(urep.tsp_replies, 0))::numeric)
      / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - p.created_at)) / (7 * 86400))::numeric,
      2
    ) AS posts_per_week
  FROM profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  LEFT JOIN user_rooms ur     ON ur.user_id = p.id
  LEFT JOIN user_co_members ucm ON ucm.user_id = p.id
  LEFT JOIN user_invites ui   ON ui.created_by = p.id
  LEFT JOIN user_threads ut   ON ut.author_id = p.id
  LEFT JOIN user_replies urep ON urep.author_id = p.id
  WHERE COALESCE(p.is_seed, false) = false
  ORDER BY GREATEST(ut.last_thread_at, urep.last_reply_at) DESC NULLS LAST;
END $$;


-- Per-user activity drill-down. Threads + replies, chronological. Includes
-- soft-deleted (UI shows them with a flag). For threads, joins through
-- group_threads to surface room context — a thread shared into multiple
-- rooms produces multiple rows, which is informative for admin. Replies
-- carry their own group_id.

CREATE OR REPLACE FUNCTION public.get_admin_user_activity(p_user_id uuid)
RETURNS TABLE (
  kind        text,
  thread_id   text,
  reply_id    text,
  show_id     text,
  group_id    uuid,
  group_name  text,
  is_public   boolean,
  is_deleted  boolean,
  season      integer,
  episode     integer,
  body        text,
  title       text,
  created_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    'thread'::text                  AS kind,
    t.id                            AS thread_id,
    NULL::text                      AS reply_id,
    t.show_id,
    fg.id                           AS group_id,
    fg.name                         AS group_name,
    t.is_public,
    COALESCE(t.is_deleted, false)   AS is_deleted,
    t.season,
    t.episode,
    LEFT(t.body, 200)               AS body,
    t.title                         AS title,
    t.created_at
  FROM threads t
  LEFT JOIN group_threads gt ON gt.thread_id = t.id
  LEFT JOIN friend_groups fg ON fg.id = gt.group_id
  WHERE t.author_id = p_user_id

  UNION ALL

  SELECT
    'reply'::text                   AS kind,
    r.thread_id                     AS thread_id,
    r.id                            AS reply_id,
    r.show_id,
    fg.id                           AS group_id,
    fg.name                         AS group_name,
    NULL::boolean                   AS is_public,
    COALESCE(r.is_deleted, false)   AS is_deleted,
    r.season,
    r.episode,
    LEFT(r.body, 200)               AS body,
    NULL::text                      AS title,
    r.created_at
  FROM replies r
  LEFT JOIN friend_groups fg ON fg.id = r.group_id
  WHERE r.author_id = p_user_id

  ORDER BY created_at DESC;
END $$;
