-- ============================================================================
-- Curated browse lists — SEED (2026-08-17). Alborz's two starter lists.
-- Shows resolved on TVMaze 2026-08-17 (ids + medium posters). Safe to re-run:
-- lists are matched by title, shows upsert by (list, tvmaze_id).
--
-- To EXTEND a list later: add rows to the matching insert below (any TVMaze
-- id + name + poster) and re-paste — or hand Claude the titles for a fresh
-- paste-ready block. The client draws a random 8 per list per DAY, so a
-- longer list = a fresher row.
-- ============================================================================

insert into public.browse_lists (title, sort_order)
select v.title, v.sort_order
from (values
  ('OK, OK, it''s finally time to watch:', 0),
  ('Family is complicated:',              1)
) as v(title, sort_order)
where not exists (select 1 from public.browse_lists l where l.title = v.title);

-- "OK, OK, it's finally time to watch:"
insert into public.browse_list_shows (list_id, tvmaze_id, name, image_url, sort_order)
select l.id, v.tvmaze_id, v.name, v.image_url, v.sort_order
from public.browse_lists l
join (values
  (179,   'The Wire',         'https://static.tvmaze.com/uploads/images/medium_portrait/504/1260189.jpg', 0),
  (23470, 'Succession',       'https://static.tvmaze.com/uploads/images/medium_portrait/453/1134275.jpg', 1),
  (138,   'The Leftovers',    'https://static.tvmaze.com/uploads/images/medium_portrait/503/1259794.jpg', 2),
  (523,   'The West Wing',    'https://static.tvmaze.com/uploads/images/medium_portrait/4/11284.jpg',     3),
  (565,   'Deadwood',         'https://static.tvmaze.com/uploads/images/medium_portrait/4/11724.jpg',     4),
  (618,   'Better Call Saul', 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253515.jpg', 5)
) as v(tvmaze_id, name, image_url, sort_order) on true
where l.title = 'OK, OK, it''s finally time to watch:'
on conflict (list_id, tvmaze_id) do update
  set name = excluded.name, image_url = excluded.image_url, sort_order = excluded.sort_order;

-- "Family is complicated:"
insert into public.browse_list_shows (list_id, tvmaze_id, name, image_url, sort_order)
select l.id, v.tvmaze_id, v.name, v.image_url, v.sort_order
from public.browse_lists l
join (values
  (37387, 'The Righteous Gemstones', 'https://static.tvmaze.com/uploads/images/medium_portrait/560/1401883.jpg', 0),
  (525,   'Gilmore Girls',           'https://static.tvmaze.com/uploads/images/medium_portrait/4/11308.jpg',     1),
  (54198, 'The Bear',                'https://static.tvmaze.com/uploads/images/medium_portrait/629/1574642.jpg', 2),
  (17128, 'This Is Us',              'https://static.tvmaze.com/uploads/images/medium_portrait/401/1003345.jpg', 3),
  (23470, 'Succession',              'https://static.tvmaze.com/uploads/images/medium_portrait/453/1134275.jpg', 4)
) as v(tvmaze_id, name, image_url, sort_order) on true
where l.title = 'Family is complicated:'
on conflict (list_id, tvmaze_id) do update
  set name = excluded.name, image_url = excluded.image_url, sort_order = excluded.sort_order;

-- Verify:
-- select l.title, count(*) from browse_lists l join browse_list_shows s on s.list_id = l.id group by 1;
