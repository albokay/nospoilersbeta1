-- ============================================================================
-- Self-serve account deletion — ANONYMIZE model.
--
-- Permanently removes the caller's identity/PII and personal state, KEEPS their
-- shared-room entries & replies (re-labeled "[deleted]" and DETACHED so the
-- person disappears from the map/member views just like a no-writing member who
-- left), and hard-deletes their PRIVATE (owner-only) writing. Groups/rooms the
-- user CREATED are left intact for the other members.
--
-- SAFETY: every statement is keyed to the caller (auth.uid()). The only place
-- that touches rows by thread rather than by owner is the private-thread
-- hard-delete, which is scoped to OWNER-ONLY threads (is_public = false AND not
-- shared to any room) so it can never remove another user's replies or likes on
-- a public/shared post. Public and shared posts are anonymized-and-kept.
--
-- profiles.id and auth.users.id are DECOUPLED (no FK), so this only touches
-- public-schema rows. The auth.users email/password scrub is done separately by
-- the delete-account edge function via the Admin API — keeping the auth.users
-- row avoids the large ON DELETE CASCADE blast radius (people_groups.created_by
-- / friend_groups.created_by, etc.).
--
-- SECURITY DEFINER + auth.uid(): must be called with the user's JWT (a
-- user-scoped client), never the service role. Idempotent — safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.anonymize_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tag text := '[deleted]';
  _private_ids text[];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── 1. Hard-delete PRIVATE (owner-only) threads authored by the caller ────
  -- "Private" = is_public = false AND not shared to any friend room (no
  -- group_threads row). This EXCLUDES public-stream posts, which are visible to
  -- others and may carry other users' replies/likes — those are anonymized-kept
  -- in step 2 instead. A private thread is owner-only, so every reply/like on it
  -- belongs to the caller.
  -- FK order (likes_threads/likes_replies/replies -> threads are NO ACTION):
  --   likes on their replies -> their replies -> likes on the thread -> thread.
  SELECT array_agg(t.id) INTO _private_ids
  FROM threads t
  WHERE t.author_id = _uid
    AND t.is_public = false
    AND t.id NOT IN (SELECT thread_id FROM group_threads);

  IF _private_ids IS NOT NULL THEN
    DELETE FROM likes_replies
     WHERE reply_id IN (SELECT id FROM replies WHERE thread_id = ANY(_private_ids));
    DELETE FROM replies       WHERE thread_id = ANY(_private_ids);
    DELETE FROM likes_threads WHERE thread_id = ANY(_private_ids);
    DELETE FROM threads       WHERE id = ANY(_private_ids);
  END IF;

  -- ── 2. Detach + anonymize KEPT content (shared-room + public posts) ───────
  -- author_name is what the feed displays; nulling author_id removes the person
  -- from the map's writing filter (they vanish from the map like a no-writing
  -- departer) while the entry text stays visible as "[deleted]". Other users'
  -- replies on these threads are untouched.
  UPDATE threads  SET author_name = _tag, author_id = NULL WHERE author_id = _uid;
  UPDATE replies  SET author_name = _tag, author_id = NULL WHERE author_id = _uid;

  -- Identity row: kept (content FKs rely on it existing) but stripped. Username
  -- must stay UNIQUE, so a per-user placeholder; it is effectively never shown
  -- because deletion removes the user from every membership/author view.
  UPDATE profiles SET username = 'deleted_' || left(_uid::text, 8), bio = NULL WHERE id = _uid;

  -- Feedback: keep the message for admins, de-identify it.
  UPDATE feedback SET username = _tag, user_id = NULL WHERE user_id = _uid;

  -- ── 3. Delete personal state / participation / live-surface presence ──────
  -- Every predicate below matches ONLY the caller's own rows.
  DELETE FROM likes_threads               WHERE user_id = _uid;
  DELETE FROM likes_replies               WHERE user_id = _uid;
  DELETE FROM progress                    WHERE user_id = _uid;
  DELETE FROM browse_progress             WHERE user_id = _uid;
  DELETE FROM episode_ratings             WHERE user_id = _uid;
  DELETE FROM group_show_votes            WHERE user_id = _uid;
  DELETE FROM poll_responses              WHERE responder_id = _uid;
  DELETE FROM poll_dismissals             WHERE user_id = _uid;
  DELETE FROM sikw_dismissals             WHERE user_id = _uid;
  DELETE FROM highlights                  WHERE author_id = _uid;
  DELETE FROM pings                       WHERE sender_id = _uid OR recipient_id = _uid;
  DELETE FROM friend_group_thread_views   WHERE user_id = _uid;
  DELETE FROM user_thread_public_views    WHERE user_id = _uid;
  DELETE FROM friend_group_members        WHERE user_id = _uid;
  DELETE FROM people_group_members        WHERE user_id = _uid;
  DELETE FROM friend_group_departed_members WHERE user_id = _uid;
  DELETE FROM group_messages              WHERE author_id = _uid;
  DELETE FROM profile_thoughts            WHERE author_id = _uid;
  DELETE FROM invitations                 WHERE created_by = _uid;
  DELETE FROM people_group_invitations    WHERE created_by = _uid;
  DELETE FROM pending_public_responses    WHERE requester_id = _uid OR owner_id = _uid;
  DELETE FROM public_room_permissions     WHERE owner_id = _uid OR responder_id = _uid;
  DELETE FROM rate_limits                 WHERE user_id = _uid;
END;
$$;

-- Callable only by an authenticated user, acting on themselves (auth.uid()).
REVOKE ALL ON FUNCTION public.anonymize_own_account() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.anonymize_own_account() TO authenticated;
