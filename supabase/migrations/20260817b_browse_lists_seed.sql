-- ============================================================================
-- Curated browse lists — SEED (2026-08-17; extended same day to 12 + 12).
-- Alborz's two starter lists. Shows resolved on TVMaze (ids + medium posters).
-- Safe to re-run: lists are matched by title, shows upsert by (list, tvmaze_id).
-- This file is the FULL current definition of both lists.
--
-- To EXTEND a list later: add rows to the matching insert below (any TVMaze
-- id + name + poster) and re-paste — or hand Claude the titles for a fresh
-- paste-ready block. The client draws a random 10 per list per DAY, so a
-- longer list = a fresher row.
--
-- NOTE: Succession is in "Family is complicated:" ONLY (Alborz 2026-08-17 —
-- the page-wide no-dupe rule would otherwise claim it for the first row).
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
  (179,   'The Wire',            'https://static.tvmaze.com/uploads/images/medium_portrait/504/1260189.jpg', 0),
  (138,   'The Leftovers',       'https://static.tvmaze.com/uploads/images/medium_portrait/503/1259794.jpg', 1),
  (523,   'The West Wing',       'https://static.tvmaze.com/uploads/images/medium_portrait/4/11284.jpg',     2),
  (565,   'Deadwood',            'https://static.tvmaze.com/uploads/images/medium_portrait/4/11724.jpg',     3),
  (221,   'Rectify',             'https://static.tvmaze.com/uploads/images/medium_portrait/1/3655.jpg',      4),
  (2747,  'Show Me a Hero',      'https://static.tvmaze.com/uploads/images/medium_portrait/331/828765.jpg',  5),
  (618,   'Better Call Saul',    'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253515.jpg', 6),
  (191,   'Halt and Catch Fire', 'https://static.tvmaze.com/uploads/images/medium_portrait/1/2798.jpg',      7),
  (2228,  'Gomorrah',            'https://static.tvmaze.com/uploads/images/medium_portrait/290/726024.jpg',  8),
  (157,   'The Americans',       'https://static.tvmaze.com/uploads/images/medium_portrait/146/366911.jpg',  9),
  (527,   'The Sopranos',        'https://static.tvmaze.com/uploads/images/medium_portrait/4/11341.jpg',     10),
  (1269,  'Enlightened',         'https://static.tvmaze.com/uploads/images/medium_portrait/7/18314.jpg',     11)
) as v(tvmaze_id, name, image_url, sort_order) on true
where l.title = 'OK, OK, it''s finally time to watch:'
on conflict (list_id, tvmaze_id) do update
  set name = excluded.name, image_url = excluded.image_url, sort_order = excluded.sort_order;

-- "Family is complicated:"
insert into public.browse_list_shows (list_id, tvmaze_id, name, image_url, sort_order)
select l.id, v.tvmaze_id, v.name, v.image_url, v.sort_order
from public.browse_lists l
join (values
  (525,   'Gilmore Girls',           'https://static.tvmaze.com/uploads/images/medium_portrait/4/11308.jpg',     0),
  (37387, 'The Righteous Gemstones', 'https://static.tvmaze.com/uploads/images/medium_portrait/560/1401883.jpg', 1),
  (54198, 'The Bear',                'https://static.tvmaze.com/uploads/images/medium_portrait/629/1574642.jpg', 2),
  (17128, 'This Is Us',              'https://static.tvmaze.com/uploads/images/medium_portrait/401/1003345.jpg', 3),
  (23470, 'Succession',              'https://static.tvmaze.com/uploads/images/medium_portrait/453/1134275.jpg', 4),
  (1372,  'Bloodline',               'https://static.tvmaze.com/uploads/images/medium_portrait/177/444579.jpg',  5),
  (63268, 'DTF St. Louis',           'https://static.tvmaze.com/uploads/images/medium_portrait/615/1538778.jpg', 6),
  (367,   'Six Feet Under',          'https://static.tvmaze.com/uploads/images/medium_portrait/2/5480.jpg',      7),
  (321,   'Arrested Development',    'https://static.tvmaze.com/uploads/images/medium_portrait/338/846049.jpg',  8),
  (1775,  'Schitt''s Creek',         'https://static.tvmaze.com/uploads/images/medium_portrait/279/697623.jpg',  9),
  (13417, 'Ozark',                   'https://static.tvmaze.com/uploads/images/medium_portrait/398/996611.jpg',  10),
  (150,   'Shameless',               'https://static.tvmaze.com/uploads/images/medium_portrait/486/1215661.jpg', 11)
) as v(tvmaze_id, name, image_url, sort_order) on true
where l.title = 'Family is complicated:'
on conflict (list_id, tvmaze_id) do update
  set name = excluded.name, image_url = excluded.image_url, sort_order = excluded.sort_order;

-- Verify:
-- select l.title, count(*) from browse_lists l join browse_list_shows s on s.list_id = l.id group by 1;
