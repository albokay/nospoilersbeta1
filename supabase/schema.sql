-- ============================================================
-- SIDEBAR — database schema
-- Run this once in Supabase SQL Editor
-- ============================================================

-- Profiles (one per user; seed authors have is_seed = true)
create table profiles (
  id         uuid primary key,
  username   text unique not null,
  is_seed    boolean default false,
  created_at timestamptz default now()
);

-- Shows catalog
create table shows (
  id      text primary key,
  name    text not null,
  seasons integer[] not null
);

-- Threads (forum posts)
create table threads (
  id          text primary key,
  show_id     text references shows(id) not null,
  season      integer not null,
  episode     integer not null,
  author_id   uuid references profiles(id),
  author_name text not null,
  title       text not null,
  preview     text,
  body        text,
  is_private  boolean default false,
  likes_count integer default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Replies
create table replies (
  id          text primary key,
  thread_id   text references threads(id) not null,
  show_id     text references shows(id) not null,
  season      integer not null,
  episode     integer not null,
  author_id   uuid references profiles(id),
  author_name text not null,
  body        text not null,
  reply_to_id text references replies(id),
  likes_count integer default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Thread likes (one per user per thread)
create table likes_threads (
  user_id   uuid references profiles(id),
  thread_id text references threads(id),
  primary key (user_id, thread_id)
);

-- Reply likes (one per user per reply)
create table likes_replies (
  user_id  uuid references profiles(id),
  reply_id text references replies(id),
  primary key (user_id, reply_id)
);

-- Watch progress (one row per user per show)
create table progress (
  user_id  uuid references profiles(id),
  show_id  text references shows(id),
  season   integer not null,
  episode  integer not null,
  primary key (user_id, show_id)
);
