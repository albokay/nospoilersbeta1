-- ============================================================================
-- Browse rows (2026-08-17) — the group room's poster shelves.
--
-- Two kinds of row:
--   • AUTO rows ("Starting up", "Popular now") — rebuilt DAILY by the
--     build-browse-rows edge function from TVMaze's schedules (streaming +
--     US network), filtered to English scripted/animated shows on a
--     network/streamer shortlist. Stored here so every visitor reads one small
--     table instead of walking TVMaze (rate-limited per visitor).
--   • CURATED lists (Alborz-authored, "OK, OK, it's finally time to watch:"
--     etc.) — a title + ordered shows with their TVMaze poster URL saved at
--     authoring time (zero API calls at view time). The client draws a
--     date-seeded random 8 per list per day.
--
-- Everything here is PUBLIC TV DATA (no user data), so reads are open to
-- anon + authenticated. Writes: the auto rows are written only by the edge
-- function (service role, bypasses RLS — no write policies at all); the
-- curated lists are admin-only (is_admin()) for the future in-app editor.
--
-- The nightly job reuses the digest's Vault secret + gate header — same
-- trust boundary (our scheduler → our function), nothing new to provision.
-- Re-applying is safe.
-- ============================================================================

-- ── Auto rows ───────────────────────────────────────────────────────────────
create table if not exists public.browse_shows (
  row_key     text        not null check (row_key in ('starting_up', 'popular')),
  tvmaze_id   integer     not null,
  rank        integer     not null,                 -- 0 = first in the row
  name        text        not null,
  image_url   text,                                 -- TVMaze medium poster
  channel     text,                                 -- network / streamer name
  kind        text,                                 -- starting_up: 'premiere' | 'returns'
  season      integer,                              -- starting_up: the season starting
  air_date    date,                                 -- starting_up: that episode's date
  weight      integer,                              -- TVMaze popularity score (0–100)
  computed_at timestamptz not null default now(),
  primary key (row_key, tvmaze_id)
);
create index if not exists browse_shows_row_rank_idx on public.browse_shows (row_key, rank);

alter table public.browse_shows enable row level security;
drop policy if exists browse_shows_select on public.browse_shows;
create policy browse_shows_select on public.browse_shows
  for select to anon, authenticated using (true);
-- No insert/update/delete policies: only the service role (edge fn) writes.

-- ── Curated lists ───────────────────────────────────────────────────────────
create table if not exists public.browse_lists (
  id          uuid        primary key default gen_random_uuid(),
  title       text        not null,
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);
create table if not exists public.browse_list_shows (
  list_id     uuid        not null references public.browse_lists(id) on delete cascade,
  tvmaze_id   integer     not null,
  name        text        not null,
  image_url   text,
  sort_order  integer     not null default 0,
  primary key (list_id, tvmaze_id)
);

alter table public.browse_lists      enable row level security;
alter table public.browse_list_shows enable row level security;

drop policy if exists browse_lists_select on public.browse_lists;
create policy browse_lists_select on public.browse_lists
  for select to anon, authenticated using (true);
drop policy if exists browse_lists_admin_write on public.browse_lists;
create policy browse_lists_admin_write on public.browse_lists
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists browse_list_shows_select on public.browse_list_shows;
create policy browse_list_shows_select on public.browse_list_shows
  for select to anon, authenticated using (true);
drop policy if exists browse_list_shows_admin_write on public.browse_list_shows;
create policy browse_list_shows_admin_write on public.browse_list_shows
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Nightly rebuild (pg_cron → edge function) ───────────────────────────────
-- Same shape as run_friend_room_digest: reads the shared secret from Vault
-- and POSTs it to the function. Time-of-day doesn't matter here (no email
-- goes out), so ONE UTC slot: 10:00 UTC = 3am PDT / 2am PST.
create or replace function public.run_build_browse_rows()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'digest_cron_secret'
   limit 1;
  if v_secret is null then
    raise warning 'digest_cron_secret missing from Vault; skipping browse-rows build';
    return;
  end if;

  perform net.http_post(
    url     := 'https://haepqyykmwnyyijkbvci.supabase.co/functions/v1/build-browse-rows',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-digest-secret', v_secret
    ),
    body    := '{}'::jsonb
  );
end;
$$;

-- Cron-only, like run_friend_room_digest (security CP2 precedent).
revoke all on function public.run_build_browse_rows() from public, anon, authenticated;

select cron.schedule('build-browse-rows', '0 10 * * *', $$ select public.run_build_browse_rows(); $$);
