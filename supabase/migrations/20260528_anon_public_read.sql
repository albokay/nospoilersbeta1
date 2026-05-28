-- 2026-05-28 — Let logged-out visitors read public content.
--
-- Before this migration, anyone not signed in saw empty feeds on every
-- public surface (the public show page, the public thread view, the
-- public profile, and the per-user-per-show aggregate). They could
-- navigate to those pages (the show catalog + profile rows were already
-- world-readable) but the underlying posts and replies were locked to
-- authenticated readers, so the spoiler picker was theatre — picking
-- progress never produced any content.
--
-- Privacy posture preserved: only is_public=true AND is_deleted=false
-- threads are exposed to anon, and only replies under those threads
-- whose group_id IS NULL (i.e. the public-conversation channel).
-- Friend-room threads (is_public=false) and friend-room replies
-- (group_id IS NOT NULL) remain invisible to anon, matching the
-- existing privacy model.
--
-- Writes are unchanged: logged-out visitors still cannot post, edit,
-- reply, like, or interact. Only SELECT is being opened.
--
-- The two new policies sit alongside the existing authenticated-only
-- policies; Postgres OR-combines policies for the same command, so
-- authenticated users' visibility is unchanged.

BEGIN;

CREATE POLICY "threads_select_anon"
  ON public.threads FOR SELECT
  TO anon
  USING (is_public = true AND is_deleted = false);

CREATE POLICY "replies_select_anon"
  ON public.replies FOR SELECT
  TO anon
  USING (
    group_id IS NULL
    AND is_deleted = false
    AND EXISTS (
      SELECT 1 FROM public.threads t
      WHERE t.id = replies.thread_id
        AND t.is_public = true
        AND t.is_deleted = false
    )
  );

COMMIT;
