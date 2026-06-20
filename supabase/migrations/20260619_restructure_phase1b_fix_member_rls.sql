-- ============================================================
-- Restructure Phase 1b — fix self-referential RLS recursion
-- ============================================================
-- The phase-1 SELECT policy on people_group_members queried
-- people_group_members inside its own USING clause. Postgres treats that as
-- infinite recursion (ERROR 42P17) and rejects EVERY read of the table — so
-- the groups rail came up empty and newly-created groups never appeared.
--
-- Fix: a SECURITY DEFINER helper that checks membership while BYPASSING RLS
-- (so the inner read doesn't re-trigger the policy), and rewrite all three
-- restructure SELECT policies to use it. Supersedes the phase-1 policies.
--
-- Idempotent, additive, safe to apply on the live DB.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_member_of_people_group(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.people_group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_member_of_people_group(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_member_of_people_group(UUID) TO authenticated;

-- people_groups: visible to members.
DROP POLICY IF EXISTS people_groups_select_member ON public.people_groups;
CREATE POLICY people_groups_select_member
  ON public.people_groups
  FOR SELECT
  USING (public.is_member_of_people_group(id));

-- people_group_members: members can see the full roster of their groups.
-- (No longer self-referential — the helper bypasses RLS internally.)
DROP POLICY IF EXISTS people_group_members_select_member ON public.people_group_members;
CREATE POLICY people_group_members_select_member
  ON public.people_group_members
  FOR SELECT
  USING (public.is_member_of_people_group(group_id));

-- group_show_votes: visible to members (drives pill counts).
DROP POLICY IF EXISTS group_show_votes_select_member ON public.group_show_votes;
CREATE POLICY group_show_votes_select_member
  ON public.group_show_votes
  FOR SELECT
  USING (public.is_member_of_people_group(group_id));
