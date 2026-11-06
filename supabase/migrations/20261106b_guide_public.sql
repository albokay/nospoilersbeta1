-- ============================================================
-- 2026-11-06 — The show guide is Sidebar's one public corner
-- ============================================================
-- His note: in the show guide only, letters from people who AREN'T your
-- friends show too (a friend may be answering one), by the same seal as
-- everywhere: readable once you're at or past where it was written FROM,
-- a sealed row with the lock before that. They never notify: the
-- dashboard's guide note (get_guide_letter_signals), the daily email and
-- the pushes stay friends-only, untouched here.
--
--   guide_letters_select       anyone signed in, past the from position
--                              (was: friends only). Writers still see their
--                              own; insert / update policies unchanged.
--   get_guide_sealed_letters   the guide's sealed rows: EVERYONE's letters
--                              on this show ahead of you (who, how many,
--                              where from; never a body), the
--                              get_guide_letter_signals row shape with
--                              relation 'behind'. No position = no rows,
--                              as the signals' 'none'.
--   get_my_friend_ids          the people in your live watch groups: the
--                              guide's blue "new" counts friends' letters
--                              only (his yes 4).
--
-- Apply in the SQL editor as ONE paste (a transaction).
-- Idempotent: DROP POLICY IF EXISTS / CREATE OR REPLACE.
-- ============================================================

begin;

drop policy if exists guide_letters_select on public.guide_letters;
create policy guide_letters_select
  on public.guide_letters for select to authenticated
  using (
    deleted_at is null
    and (
      user_id = auth.uid()
      or public.viewer_past_episode(show_id, from_season, from_episode)
    )
  );

create or replace function public.get_guide_sealed_letters(p_show_id text)
returns table (
  show_id       text,
  show_name     text,
  season        integer,
  episode       integer,
  from_season   integer,
  from_episode  integer,
  writer_ids    uuid[],
  letter_count  integer,
  latest_at     timestamptz,
  relation      text,
  seen_at       timestamptz,
  hold_seen_at  timestamptz,
  not_for_me    boolean
)
language sql stable security definer
set search_path = public
as $$
  select l.show_id,
         sh.name,
         l.season,
         l.episode,
         l.from_season,
         l.from_episode,
         array_agg(distinct l.user_id),
         count(*)::integer,
         max(l.created_at),
         'behind'::text,
         null::timestamptz,
         null::timestamptz,
         false
    from public.guide_letters l
    join public.shows sh on sh.id = l.show_id
   where l.deleted_at is null
     and l.show_id = p_show_id
     and l.user_id <> auth.uid()
     -- A position on the show (the signals' 'none' otherwise).
     and exists (
       select 1 from public.progress p
        where p.user_id = auth.uid() and p.show_id = p_show_id
          and (case when p.is_rewatching and p.highest_season is not null and p.highest_episode is not null
                    then p.highest_season else p.season end) > 0
     )
     and not public.viewer_past_episode(l.show_id, l.from_season, l.from_episode)
   group by l.show_id, sh.name, l.season, l.episode, l.from_season, l.from_episode
   order by l.season, l.episode;
$$;
revoke all on function public.get_guide_sealed_letters(text) from public, anon;
grant execute on function public.get_guide_sealed_letters(text) to authenticated;

create or replace function public.get_my_friend_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select distinct b.user_id
    from public.people_group_members a
    join public.people_group_members b on b.group_id = a.group_id and b.user_id <> a.user_id
    join public.people_groups g        on g.id = a.group_id and g.deleted_at is null
   where a.user_id = auth.uid();
$$;
revoke all on function public.get_my_friend_ids() from public, anon;
grant execute on function public.get_my_friend_ids() to authenticated;

commit;

-- Read-only check after applying:
-- select pg_get_expr(polqual, polrelid) from pg_policy
--  where polrelid = 'public.guide_letters'::regclass and polname = 'guide_letters_select';
