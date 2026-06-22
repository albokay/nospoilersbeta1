-- ============================================================
-- Group chat — enable Supabase Realtime
-- ============================================================
-- ADDITIVE, idempotent. Adds public.group_messages to the supabase_realtime
-- publication so members get new chat messages pushed over the websocket
-- (filtered client-side to a single group_id; append-only). Realtime honours
-- the table's existing member-gated SELECT RLS, so non-members receive nothing.
--
-- REPLICA IDENTITY FULL gives change payloads the full row (not strictly needed
-- for INSERT-only chat, but harmless and future-proofs UPDATE/DELETE).
-- ============================================================

ALTER TABLE public.group_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'group_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
  END IF;
END $$;
