-- "Your shows" arc CP2 (2026-09-07): the dashboard's "You want to watch:"
-- shelf. wanted_at stamps intent on the viewer's own progress row (a rowless
-- show gets a fresh S0E0 row); the shelf shows wanted_at set + progress
-- still below S1E1, so starting the show migrates it to Watching on its own.
alter table public.progress add column if not exists wanted_at timestamptz;
