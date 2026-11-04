-- ============================================================================
-- 2026-11-04 — Stand alone mode, CP1: the data (his design, canvas
-- Y3k7yZ5gvQqW5qC6fTeGdX).
--
-- Some shows only need spoiler-gating per season (reality TV, game shows…).
-- In stand alone mode a person holds a PLACE PER SEASON on the show instead
-- of one position on the whole of it. This migration adds the memory and
-- the switch; nothing here changes how anything is sealed (CP2/CP3 do).
--
--   shows.stand_alone        the show's switch, for everyone: null = decided
--                            by its TVMaze type (show_stand_alone()), true /
--                            false = someone flipped it.
--   progress_seasons         one row per person × show × season: where they
--                            are in that season. Written on EVERY progress
--                            write (switch on or off), so switching off and
--                            back on loses nothing. Own rows only; friends'
--                            places reach the map through an RPC (CP4).
--   set_show_stand_alone()   the switch's write (shows' UPDATE is column-
--                            locked to the refresh columns since 06-30).
--
-- Apply in the SQL editor. Read-only verification at the foot.
-- ============================================================================

alter table public.shows add column if not exists stand_alone boolean;

create or replace function public.show_stand_alone(p_show_id text)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    s.stand_alone,
    lower(coalesce(s.tvmaze_type, '')) = any (array[
      'reality', 'talk show', 'documentary', 'game show', 'news', 'sports', 'variety', 'award show', 'panel show'
    ])
  )
  from public.shows s
  where s.id = p_show_id;
$$;

create or replace function public.set_show_stand_alone(p_show_id text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authorized';
  end if;
  update public.shows set stand_alone = p_on where id = p_show_id;
end;
$$;

revoke all on function public.set_show_stand_alone(text, boolean) from public, anon;
grant execute on function public.set_show_stand_alone(text, boolean) to authenticated;
grant execute on function public.show_stand_alone(text) to authenticated, anon;

create table if not exists public.progress_seasons (
  user_id    uuid not null references auth.users(id) on delete cascade,
  show_id    text not null references public.shows(id) on delete cascade,
  season     integer not null,
  episode    integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, show_id, season)
);

alter table public.progress_seasons enable row level security;

drop policy if exists progress_seasons_select_own on public.progress_seasons;
create policy progress_seasons_select_own on public.progress_seasons
  for select to authenticated using (user_id = auth.uid());

drop policy if exists progress_seasons_insert_own on public.progress_seasons;
create policy progress_seasons_insert_own on public.progress_seasons
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists progress_seasons_update_own on public.progress_seasons;
create policy progress_seasons_update_own on public.progress_seasons
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.progress_seasons to authenticated;

-- Verification (read-only): the column, the table and the two functions.
-- select column_name from information_schema.columns where table_name = 'shows' and column_name = 'stand_alone';
-- select count(*) from public.progress_seasons;
-- select public.show_stand_alone('survivor');
