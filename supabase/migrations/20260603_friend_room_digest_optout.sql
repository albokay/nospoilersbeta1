-- Friend-room daily digest emails — per-room opt-out preference (lean v1).
-- Spec: sidebar_spec_friend_room_digest_emails.md
--
-- Digests are ON by default for every membership (digest_opt_out = false).
-- The opt-out lives per (user, room) on friend_group_members, mirroring the
-- existing last_seen_at pattern (20260425_room_last_seen.sql). New members
-- inherit the default automatically, so future joins are opted-in with no
-- extra wiring.
--
-- Privacy: other members' digest preferences are PRIVATE. The column is not
-- readable via the REST API (column-level REVOKE below); the viewing user
-- reads/writes only their OWN preference through the SECURITY DEFINER RPCs.
-- The digest sender runs as the service role, which bypasses the column grant
-- and can read everyone's preference server-side.
--
-- Safe to apply: every existing client SELECT on friend_group_members names
-- explicit columns (none use SELECT *), so revoking SELECT on just this one
-- column does not break any current query.

ALTER TABLE friend_group_members
  ADD COLUMN IF NOT EXISTS digest_opt_out BOOLEAN NOT NULL DEFAULT false;

REVOKE SELECT (digest_opt_out) ON friend_group_members FROM anon, authenticated;

-- Read the caller's own opt-out for one room. Returns false (digests on) when
-- there is no membership row, so the UI degrades safely.
CREATE OR REPLACE FUNCTION public.get_room_digest_opt_out(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT digest_opt_out
       FROM friend_group_members
      WHERE group_id = p_group_id
        AND user_id = auth.uid()),
    false
  );
$$;

-- Set the caller's own opt-out for one room. Only ever touches the caller's
-- own membership row (WHERE user_id = auth.uid()).
CREATE OR REPLACE FUNCTION public.set_room_digest_opt_out(p_group_id uuid, p_opt_out boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE friend_group_members
     SET digest_opt_out = p_opt_out
   WHERE group_id = p_group_id
     AND user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_room_digest_opt_out(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_digest_opt_out(uuid, boolean) TO authenticated;
