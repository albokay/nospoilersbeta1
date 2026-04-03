-- Run this in the Supabase SQL Editor to set up the feedback system

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  username text,
  page_url text,
  message text not null,
  status text check (status in ('will-do', 'consider', 'done', 'ignore')) default null,
  created_at timestamptz default now(),
  read_at timestamptz default null
);

alter table public.feedback enable row level security;

-- Authenticated users can insert their own feedback
create policy "users insert own feedback" on public.feedback
  for insert to authenticated
  with check (auth.uid() = user_id);

-- Admin can read all feedback
create policy "admin read all feedback" on public.feedback
  for select to authenticated
  using (auth.uid() = 'b4b37a6c-1f14-4189-9347-6ddbcadb99a6'::uuid);

-- Admin can update feedback (status, read_at)
create policy "admin update feedback" on public.feedback
  for update to authenticated
  using (auth.uid() = 'b4b37a6c-1f14-4189-9347-6ddbcadb99a6'::uuid);

-- Admin can delete feedback
create policy "admin delete feedback" on public.feedback
  for delete to authenticated
  using (auth.uid() = 'b4b37a6c-1f14-4189-9347-6ddbcadb99a6'::uuid);
