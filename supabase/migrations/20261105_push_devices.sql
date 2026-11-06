-- ============================================================
-- Push notifications CP1 (2026-11-05): the devices that said yes.
--
-- One row per browser/phone that turned notifications on. The endpoint is
-- the push service's address for that device; p256dh + auth are the device's
-- own keys, so only it can read what's sent. The time zone rides along for
-- CP2's quiet hours (no pushes 10pm–8am where the device is).
--
-- Reads and deletes: your own rows only. Writes go through
-- save_push_device(), so a device that changes hands (one person signs out,
-- another signs in and turns it on) moves to the new account instead of
-- failing on the old owner's row. Only the send-pushes function (service
-- role) reads everyone's rows.
--
-- Re-applying is safe.
-- ============================================================

create table if not exists public.push_devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  time_zone   text,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists push_devices_user_idx on public.push_devices (user_id);

alter table public.push_devices enable row level security;

revoke all on public.push_devices from anon;
revoke insert, update on public.push_devices from authenticated;
grant select, delete on public.push_devices to authenticated;

drop policy if exists "push_devices own read" on public.push_devices;
create policy "push_devices own read" on public.push_devices
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "push_devices own delete" on public.push_devices;
create policy "push_devices own delete" on public.push_devices
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.save_push_device(
  p_endpoint text, p_p256dh text, p_auth text, p_time_zone text, p_user_agent text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then
    raise exception 'bad endpoint';
  end if;
  if coalesce(length(p_p256dh), 0) not between 40 and 200 or coalesce(length(p_auth), 0) not between 10 and 100 then
    raise exception 'bad keys';
  end if;
  insert into public.push_devices (user_id, endpoint, p256dh, auth, time_zone, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_time_zone, 64), left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id    = excluded.user_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        time_zone  = excluded.time_zone,
        user_agent = excluded.user_agent,
        updated_at = now();
end;
$$;

revoke all on function public.save_push_device(text, text, text, text, text) from public, anon;
grant execute on function public.save_push_device(text, text, text, text, text) to authenticated;
