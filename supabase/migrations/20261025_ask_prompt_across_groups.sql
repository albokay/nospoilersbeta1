-- ============================================================
-- 2026-10-25 — "Thoughts on…": a prompt a member just met elsewhere waits.
--
-- The picker chose per GROUP only: a prompt this group hasn't had, at random.
-- Someone in three groups could meet "Thoughts on The Wire" three times —
-- and on the first evening, when every group with a room gets its first ask
-- at once, two of their groups could draw the same one the same night. Now a
-- prompt that landed in the last six weeks in ANY other group a current
-- member of this group belongs to goes to the back of the line. Deprioritised,
-- never excluded: when every prompt has been met somewhere, the pick falls
-- back to the old order (never had here → longest ago here → random), so a
-- group always gets an ask. Same signature; nothing else changes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.pick_ask_prompt(p_group_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.key
  FROM public.ask_prompts p
  LEFT JOIN LATERAL (
    SELECT max(a.created_at) AS last_used
    FROM public.group_asks a WHERE a.group_id = p_group_id AND a.prompt_key = p.key
  ) u ON true
  LEFT JOIN LATERAL (
    -- The prompt landed recently in another group that shares a current member with this one.
    SELECT true AS met
    FROM public.group_asks a
    JOIN public.people_group_members om ON om.group_id = a.group_id
    JOIN public.people_group_members m  ON m.user_id = om.user_id AND m.group_id = p_group_id AND NOT m.migration_dormant
    WHERE a.prompt_key = p.key
      AND a.group_id <> p_group_id
      AND a.created_at > now() - interval '42 days'
    LIMIT 1
  ) x ON true
  WHERE p.active
  ORDER BY (x.met IS NULL) DESC, (u.last_used IS NULL) DESC, u.last_used ASC NULLS FIRST, random()
  LIMIT 1;
$$;
