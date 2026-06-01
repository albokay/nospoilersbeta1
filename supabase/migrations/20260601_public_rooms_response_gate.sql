-- ============================================================
-- Public Rooms — response-permission gate (CP2)
--
-- Adds the data + rules behind "who can respond in a public room":
--
--   • public_room_permissions  — an owner's approved-responders list.
--       Blanket: one row means that responder may reply in ANY of the
--       owner's public rooms (all shows). Friends are NOT stored here —
--       they're allowed implicitly (see can_respond_to_public).
--
--   • pending_public_responses — held responses from not-yet-approved
--       requesters. Parked here (invisible to readers) until the owner
--       approves; the approval flow (CP3) publishes them into `replies`
--       and inserts the matching public_room_permissions row.
--
--   • can_respond_to_public(owner, responder) — TRUE if responder is the
--       owner, shares a non-deleted friend room with the owner (any show),
--       or is on the owner's approved list. Used by BOTH the replies
--       INSERT policy (hard enforcement, can't be bypassed via any
--       surface) and the client (to pick the respond-box UI state).
--
--   • Tightened replies INSERT policy: a PUBLIC reply (group_id IS NULL)
--       to someone else's thread is only allowed for an author / friend /
--       approved responder. Friend-room replies (group_id IS NOT NULL) and
--       replies to your own thread are UNCHANGED.
-- ============================================================


-- ── 1. Approved-responders list ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.public_room_permissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  responder_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, responder_id)
);

CREATE INDEX IF NOT EXISTS idx_prp_owner     ON public.public_room_permissions(owner_id);
CREATE INDEX IF NOT EXISTS idx_prp_responder ON public.public_room_permissions(responder_id);

ALTER TABLE public.public_room_permissions ENABLE ROW LEVEL SECURITY;

-- Owner sees who they've approved; responder sees which owners approved them.
-- No INSERT/UPDATE/DELETE policy on purpose: grants happen only through the
-- approval RPC (SECURITY DEFINER, added in CP3). The table is otherwise locked
-- from the REST API.
DROP POLICY IF EXISTS prp_select ON public.public_room_permissions;
CREATE POLICY prp_select
  ON public.public_room_permissions FOR SELECT TO authenticated
  USING (auth.uid() = owner_id OR auth.uid() = responder_id);


-- ── 2. Held responses ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pending_public_responses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id            text NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  show_id              text NOT NULL REFERENCES public.shows(id)   ON DELETE CASCADE,
  owner_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requester_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requester_name       text NOT NULL,
  body                 text NOT NULL,
  message              text,             -- optional "who I am" note to the owner
  season               integer NOT NULL, -- requester's claimed-progress snapshot
  episode              integer NOT NULL, --   (so the reply is spoiler-tagged right
                                         --    whenever it is later published)
  reference_type       text,             -- quote/link passthrough (best-effort)
  referenced_reply_id  text,
  referenced_thread_id text,
  quoted_text          text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppr_owner     ON public.pending_public_responses(owner_id);
CREATE INDEX IF NOT EXISTS idx_ppr_requester ON public.pending_public_responses(requester_id);

ALTER TABLE public.pending_public_responses ENABLE ROW LEVEL SECURITY;

-- The requester can see / retract their own held responses (drives the
-- "your request is pending" UI). The owner does NOT read this table over the
-- REST API — held bodies reach the owner only through the request email
-- (CP3), which applies the spoiler-withholding rule. Resolution (publish or
-- drop) happens through the SECURITY DEFINER approval RPC.
DROP POLICY IF EXISTS ppr_select_requester ON public.pending_public_responses;
CREATE POLICY ppr_select_requester
  ON public.pending_public_responses FOR SELECT TO authenticated
  USING (auth.uid() = requester_id);

-- A user may park a held response addressed to the true author of a live
-- public thread, as themselves. owner_id must match the thread's author.
DROP POLICY IF EXISTS ppr_insert_requester ON public.pending_public_responses;
CREATE POLICY ppr_insert_requester
  ON public.pending_public_responses FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = requester_id
    AND EXISTS (
      SELECT 1 FROM public.threads t
      WHERE t.id = thread_id
        AND t.author_id = owner_id
        AND t.is_public
        AND NOT t.is_deleted
    )
  );

DROP POLICY IF EXISTS ppr_delete_requester ON public.pending_public_responses;
CREATE POLICY ppr_delete_requester
  ON public.pending_public_responses FOR DELETE TO authenticated
  USING (auth.uid() = requester_id);


-- ── 3. The gate predicate ───────────────────────────────────────────────────
-- SECURITY DEFINER so it can read friend_group_members + public_room_permissions
-- regardless of the caller's own RLS. LANGUAGE sql (no RETURNS TABLE) so it is
-- not subject to the variable-conflict footgun; every column is alias-qualified
-- anyway. Returns true for the owner themselves (covers replying to your own
-- public thread).
CREATE OR REPLACE FUNCTION public.can_respond_to_public(p_owner uuid, p_responder uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_owner = p_responder
    OR EXISTS (
      SELECT 1
      FROM friend_group_members a
      JOIN friend_group_members b ON a.group_id = b.group_id
      JOIN friend_groups        g ON g.id = a.group_id
      WHERE a.user_id = p_owner
        AND b.user_id = p_responder
        AND g.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM public_room_permissions prp
      WHERE prp.owner_id = p_owner
        AND prp.responder_id = p_responder
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_respond_to_public(uuid, uuid) TO authenticated;


-- ── 4. Enforce the gate on public replies ───────────────────────────────────
-- Replaces the prior "you can only reply as yourself" INSERT policy. Friend-room
-- replies (group_id IS NOT NULL) keep exactly their old rule. Public replies
-- (group_id IS NULL) additionally require can_respond_to_public(author of the
-- thread, you) — which is true for your own thread, friends, and approved
-- responders. This is what makes the still-reachable old aggregate URL safe:
-- a stranger's direct insert is rejected here, on every surface.
DROP POLICY IF EXISTS "replies_insert" ON public.replies;
CREATE POLICY "replies_insert"
  ON public.replies FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_id
    AND (
      group_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.threads t
        WHERE t.id = thread_id
          AND public.can_respond_to_public(t.author_id, auth.uid())
      )
    )
  );
