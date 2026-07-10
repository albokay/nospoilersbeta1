-- First-name identity arc — CP1 (2026-07-10)
-- 1) profiles.display_name: the self-chosen first name everyone appears by.
--    Nullable (pre-backfill accounts fall back to username in the UI);
--    NOT unique by design — first names collide, user_id/username stay the
--    true identity. Length is enforced app-side (1–40 chars, same cap as
--    contact names).
-- 2) handle_new_user: the signup trigger fn (trigger on_auth_user_created on
--    auth.users; body verified on prod 2026-07-10 via pg_get_functiondef —
--    it lived only on prod, untracked until this file). Extended to also
--    persist display_name from the signup metadata. NULLIF guards the
--    pre-CP1-client case (no display_name key → null, not '').
--    SET search_path added per the standing convention for SECURITY DEFINER
--    functions (HANDOFF §6 item 21); the prod original lacked it.

alter table public.profiles add column if not exists display_name text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    new.raw_user_meta_data->>'username',
    nullif(trim(new.raw_user_meta_data->>'display_name'), '')
  );
  return new;
end;
$$;
