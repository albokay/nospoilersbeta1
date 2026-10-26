-- ============================================================
-- 2026-10-25 — "Thoughts on…" in the group chat, CP2: live takes.
-- The card listens for takes landing on the ask it shows (a filtered
-- postgres_changes subscription, member-gated by the row policy, so a
-- sealed take never reaches a viewer without their own). The table has to
-- be in the realtime publication for any event to flow. Idempotent.
-- ============================================================
ALTER TABLE public.ask_takes REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ask_takes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ask_takes;
  END IF;
END $$;
-- Verify (expect one row):
-- SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'ask_takes';
