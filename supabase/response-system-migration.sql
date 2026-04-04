-- ============================================================
-- Response Reference System Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add new columns to the replies table
alter table replies
  add column if not exists reference_type text check (reference_type in ('quote', 'link')) default null,
  add column if not exists referenced_reply_id text references replies(id) on delete set null default null,
  add column if not exists referenced_thread_id text references threads(id) on delete set null default null,
  add column if not exists quoted_text text default null;

-- Drop old reply_to_id column (replaced by the new reference system)
alter table replies drop column if exists reply_to_id;

-- 2. Create the response_citations table
create table if not exists response_citations (
  id uuid primary key default gen_random_uuid(),
  cited_reply_id text references replies(id) on delete cascade,
  cited_thread_id text references threads(id) on delete cascade,
  citing_reply_id text references replies(id) on delete cascade not null,
  created_at timestamptz default now(),
  check (
    (cited_reply_id is not null and cited_thread_id is null) or
    (cited_reply_id is null and cited_thread_id is not null)
  )
);

-- 3. Enable RLS on response_citations
alter table response_citations enable row level security;

-- Policy: authenticated users can insert their own citations
-- (citing_reply must belong to them — checked via replies.author_id)
create policy "authenticated insert own citations"
  on response_citations for insert
  to authenticated
  with check (
    exists (
      select 1 from replies r
      where r.id = citing_reply_id
        and r.author_id = auth.uid()
    )
  );

-- Policy: anyone can read citations (needed for footnote superscripts)
create policy "public select citations"
  on response_citations for select
  using (true);

-- Policy: authenticated users can delete citations they created
create policy "authenticated delete own citations"
  on response_citations for delete
  to authenticated
  using (
    exists (
      select 1 from replies r
      where r.id = citing_reply_id
        and r.author_id = auth.uid()
    )
  );
