-- "Your shows" arc CP1 (2026-09-07): the dashboard's "You're watching:"
-- shelf replaces the recent-lookups row. The X on a shelf tile hides that
-- show from the shelf (cross-device) WITHOUT touching progress; a fresh
-- reference lookup clears the flag (stampReferenceLookup writes null).
alter table public.progress add column if not exists shelf_hidden_at timestamptz;
