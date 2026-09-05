-- Spoiler-gated reference arc, CP0 (2026-09-05). BOTH pieces are ADDITIVE —
-- no existing rows or columns are touched; DROP TABLE public.show_reference
-- and ALTER TABLE public.progress DROP COLUMN last_looked_up_at fully undo it.

-- ── 1. The per-show reference cache ─────────────────────────────────────────
-- One JSON blob per show (episode list + first-appearance people + trailer
-- keys), written ONLY by the build-show-reference edge function (service
-- role bypasses RLS — deliberately no insert/update policies, so a client
-- can never poison the shared cache). Readable by any signed-in user: the
-- blob holds the WHOLE show and the client gates by the viewer's progress
-- (safe per the M1 rationale — only the viewer can spoil themselves).
create table if not exists public.show_reference (
  show_id    text primary key references public.shows(id) on delete cascade,
  data       jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.show_reference enable row level security;

drop policy if exists show_reference_select on public.show_reference;
create policy show_reference_select on public.show_reference
  for select to authenticated using (true);

-- ── 2. The "you've looked up" stamp ─────────────────────────────────────────
-- Cross-device recent-lookups row on the dashboard band (capped at 8 in the
-- query). Lives on the viewer's own progress row: direct SELECT on progress
-- is auth.uid() = user_id (verified 2026-09-05), and none of the DEFINER
-- RPCs that expose progress to others select this column — lookups stay
-- invisible to friends.
alter table public.progress add column if not exists last_looked_up_at timestamptz;
