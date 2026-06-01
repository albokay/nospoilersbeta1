-- ============================================================
-- Public Rooms — approve held responses (CP3)
--
-- Run AFTER 20260601_public_rooms_response_gate.sql (depends on its tables).
--
-- Two SECURITY DEFINER RPCs, both gated on the caller being the owner of the
-- held request (auth.uid() = owner_id), so a forwarded Allow link can't be
-- used by anyone but the owner:
--
--   • get_public_response_request(id) — summary for the Allow page: requester
--       handle, show, their note, and the response itself UNLESS the requester
--       has watched further than the owner (same spoiler rule as the email).
--
--   • approve_public_response(id) — grants the requester blanket permission to
--       respond in all of the owner's public rooms, publishes EVERY held
--       response from that requester to that owner (approving once releases the
--       whole queue), and clears them.
-- ============================================================


-- ── Summary for the Allow page ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_response_request(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req     record;
  v_owner_s integer;
  v_owner_e integer;
  v_show    text;
  v_ahead   boolean;
BEGIN
  SELECT ppr.owner_id, ppr.requester_id, ppr.show_id, ppr.season, ppr.episode,
         ppr.message, ppr.body, pr.username AS requester_username
    INTO v_req
    FROM pending_public_responses ppr
    JOIN profiles pr ON pr.id = ppr.requester_id
   WHERE ppr.id = p_id;

  IF NOT FOUND OR v_req.owner_id <> auth.uid() THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_show FROM shows WHERE id = v_req.show_id;

  -- Owner's effective progress (rewatch ceiling when rewatching).
  SELECT
    CASE WHEN p.is_rewatching AND p.highest_season  IS NOT NULL THEN p.highest_season  ELSE p.season  END,
    CASE WHEN p.is_rewatching AND p.highest_episode IS NOT NULL THEN p.highest_episode ELSE p.episode END
    INTO v_owner_s, v_owner_e
    FROM progress p
   WHERE p.user_id = v_req.owner_id AND p.show_id = v_req.show_id;

  -- Requester is "ahead" unless their tag is at or below the owner's progress.
  v_ahead := NOT (
    v_owner_s IS NOT NULL AND (
      v_req.season < v_owner_s
      OR (v_req.season = v_owner_s AND v_req.episode <= v_owner_e)
    )
  );

  RETURN jsonb_build_object(
    'requester_username', v_req.requester_username,
    'show_id',            v_req.show_id,
    'show_name',          COALESCE(NULLIF(btrim(v_show), ''), 'this show'),
    'message',            v_req.message,
    'requester_ahead',    v_ahead,
    'body',               CASE WHEN v_ahead THEN NULL ELSE v_req.body END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_response_request(uuid) TO authenticated;


-- ── Approve (publish + grant) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_public_response(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner     uuid;
  v_requester uuid;
  v_thread    text;
  v_count     integer := 0;
  r           record;
BEGIN
  SELECT ppr.owner_id, ppr.requester_id, ppr.thread_id
    INTO v_owner, v_requester, v_thread
    FROM pending_public_responses ppr
   WHERE ppr.id = p_id;

  IF NOT FOUND OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_forbidden');
  END IF;

  -- Blanket grant (idempotent): this responder may now reply in any of the
  -- owner's public rooms.
  INSERT INTO public_room_permissions (owner_id, responder_id)
    VALUES (v_owner, v_requester)
    ON CONFLICT (owner_id, responder_id) DO NOTHING;

  -- Publish EVERY held response from this requester to this owner, then clear.
  FOR r IN
    SELECT * FROM pending_public_responses
     WHERE owner_id = v_owner AND requester_id = v_requester
  LOOP
    INSERT INTO replies (
      id, thread_id, show_id, season, episode,
      author_id, author_name, body, likes_count,
      reference_type, referenced_reply_id, referenced_thread_id, quoted_text,
      group_id, is_rewatch
    ) VALUES (
      gen_random_uuid()::text, r.thread_id, r.show_id, r.season, r.episode,
      r.requester_id, r.requester_name, r.body, 0,
      r.reference_type, r.referenced_reply_id, r.referenced_thread_id, r.quoted_text,
      NULL, false
    );
    v_count := v_count + 1;
  END LOOP;

  DELETE FROM pending_public_responses
   WHERE owner_id = v_owner AND requester_id = v_requester;

  RETURN jsonb_build_object('ok', true, 'thread_id', v_thread, 'published_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_public_response(uuid) TO authenticated;
