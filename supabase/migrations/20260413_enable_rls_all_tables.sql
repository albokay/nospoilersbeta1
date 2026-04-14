-- ============================================================
-- RLS Migration: Lock down all 9 UNRESTRICTED tables
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- ── Step 0: Admin helper ────────────────────────────────────
-- Add is_admin flag to profiles (only you have it)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;
UPDATE profiles SET is_admin = true
  WHERE id = 'b4b37a6c-1f14-4189-9347-6ddbcadb99a6';

-- Helper function used by policies below
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;


-- ============================================================
-- 1. SHOWS  (public catalog — anyone reads, auth users add/refresh, admin deletes)
-- ============================================================
ALTER TABLE shows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shows_select"
  ON shows FOR SELECT
  USING (true);                          -- catalog is public

CREATE POLICY "shows_insert"
  ON shows FOR INSERT TO authenticated
  WITH CHECK (true);                     -- any logged-in user can add a show

CREATE POLICY "shows_update"
  ON shows FOR UPDATE TO authenticated
  USING (true);                          -- refreshShowIfStale runs for any user

CREATE POLICY "shows_delete"
  ON shows FOR DELETE TO authenticated
  USING (public.is_admin());             -- only admin can hard-delete


-- ============================================================
-- 2. PROFILES  (public read, owner-only write)
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select"
  ON profiles FOR SELECT
  USING (true);                          -- usernames are public (needed for posts)

CREATE POLICY "profiles_insert"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);          -- signup trigger inserts own row

CREATE POLICY "profiles_update"
  ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);              -- users can only update their own profile

CREATE POLICY "profiles_delete"
  ON profiles FOR DELETE TO authenticated
  USING (public.is_admin());              -- only admin can delete profiles


-- ============================================================
-- 3. THREADS  (auth read, owner write, admin hard-delete)
-- ============================================================
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "threads_select"
  ON threads FOR SELECT TO authenticated
  USING (true);                          -- all threads visible to logged-in users
                                         -- (spoiler filtering is client-side by design)

CREATE POLICY "threads_insert"
  ON threads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id);   -- can only post as yourself

CREATE POLICY "threads_update"
  ON threads FOR UPDATE TO authenticated
  USING (auth.uid() = author_id);        -- edit, soft-delete, toggle public — own only

CREATE POLICY "threads_delete"
  ON threads FOR DELETE TO authenticated
  USING (public.is_admin());             -- hard delete reserved for admin cascade


-- ============================================================
-- 4. REPLIES  (auth read, owner write, admin hard-delete)
-- ============================================================
ALTER TABLE replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "replies_select"
  ON replies FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "replies_insert"
  ON replies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id);   -- can only reply as yourself

CREATE POLICY "replies_update"
  ON replies FOR UPDATE TO authenticated
  USING (auth.uid() = author_id);        -- edit / soft-delete own only

CREATE POLICY "replies_delete"
  ON replies FOR DELETE TO authenticated
  USING (public.is_admin());


-- ============================================================
-- 5. PROGRESS  (owner read/write, admin delete for cascade)
-- ============================================================
ALTER TABLE progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "progress_select"
  ON progress FOR SELECT TO authenticated
  USING (auth.uid() = user_id);          -- only you can see your own progress

CREATE POLICY "progress_insert"
  ON progress FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "progress_update"
  ON progress FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "progress_delete"
  ON progress FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());


-- Since progress is now owner-only, create an RPC for public profiles
-- (returns only show_id + season + episode — no user enumeration)
CREATE OR REPLACE FUNCTION public.get_public_progress(target_user_id uuid)
RETURNS TABLE (show_id text, season int, episode int)
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT p.show_id, p.season, p.episode
  FROM public.progress p
  WHERE p.user_id = target_user_id;
$$;


-- ============================================================
-- 6. LIKES_THREADS  (owner-only — private data)
-- ============================================================
ALTER TABLE likes_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "likes_threads_select"
  ON likes_threads FOR SELECT TO authenticated
  USING (auth.uid() = user_id);          -- only see your own likes

CREATE POLICY "likes_threads_insert"
  ON likes_threads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "likes_threads_delete"
  ON likes_threads FOR DELETE TO authenticated
  USING (auth.uid() = user_id);          -- unlike


-- ============================================================
-- 7. LIKES_REPLIES  (owner-only — private data)
-- ============================================================
ALTER TABLE likes_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "likes_replies_select"
  ON likes_replies FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "likes_replies_insert"
  ON likes_replies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "likes_replies_delete"
  ON likes_replies FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ============================================================
-- 8. PROMPTS  (public read, admin-only write)
-- ============================================================
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prompts_select"
  ON prompts FOR SELECT
  USING (true);                          -- writing prompts are part of the UI

CREATE POLICY "prompts_insert"
  ON prompts FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "prompts_update"
  ON prompts FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "prompts_delete"
  ON prompts FOR DELETE TO authenticated
  USING (public.is_admin());


-- ============================================================
-- 9. THREAD_PROMPTS  (auth insert, admin read — audit log)
-- ============================================================
ALTER TABLE thread_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "thread_prompts_insert"
  ON thread_prompts FOR INSERT TO authenticated
  WITH CHECK (true);                     -- logged on thread creation

CREATE POLICY "thread_prompts_select"
  ON thread_prompts FOR SELECT TO authenticated
  USING (public.is_admin());             -- only admin sees analytics


-- ============================================================
-- Done! Verify by checking the table list in Dashboard →
-- Authentication & Authorization → Policies
-- All 9 tables should now show the 🔒 icon instead of UNRESTRICTED
-- ============================================================
