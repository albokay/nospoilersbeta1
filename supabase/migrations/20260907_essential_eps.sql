-- "Your shows" arc CP4 (2026-09-07): essential episodes for canon shows —
-- starred on the owner's reference page, listed on the shareable
-- "{Name}'s TV Canon" card. epIndex ints (season*10000+episode) on the
-- owner's own progress row; readable wherever progress already is, so the
-- later friend-facing phases need no migration.
alter table public.progress add column if not exists essential_eps integer[];
