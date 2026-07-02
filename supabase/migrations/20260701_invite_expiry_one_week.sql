-- Extend people-group invite link lifetime from 48 hours to one week.
-- create_people_group_invitation inserts without expires_at, so it relies on
-- this column default. Only affects NEW invites; existing pending invites keep
-- whatever expires_at they were stamped with. The 48h footer copy in
-- send-group-invite was updated to "a week" in the same change.
ALTER TABLE public.people_group_invitations
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');
