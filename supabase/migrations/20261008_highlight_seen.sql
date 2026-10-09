-- 2026-10-08 — Per-ACCOUNT "opened" stamp for highlight notes (Alborz's spec).
--
-- A stretch that carries readable notes AND sealed ones used to stay yellow
-- for good, hiding the sealed note behind it. Once you've OPENED its
-- readable notes (the paper on desktop, the sheet on the phone), the stretch
-- draws in the sealed style so the sealed note is what you notice next
-- time. This table is that stamp — per account, not per device (his call):
-- one row per (you, note), written the first time you open it. Rows only
-- ever accumulate, and nothing reads them but your own screens.
--
-- Nothing else moves: the room envelopes (thread_view_state), the in-room
-- blue/red note signals, the closed-letter counts, the digest and the
-- realtime dots keep their own sources.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; policies dropped and re-created.

CREATE TABLE IF NOT EXISTS public.highlight_seen (
  user_id       UUID         NOT NULL REFERENCES auth.users(id)          ON DELETE CASCADE,
  highlight_id  UUID         NOT NULL REFERENCES public.highlights(id)   ON DELETE CASCADE,
  seen_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, highlight_id)
);

ALTER TABLE public.highlight_seen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "highlight_seen: own rows" ON public.highlight_seen;
CREATE POLICY "highlight_seen: own rows"
  ON public.highlight_seen FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "highlight_seen: stamp own" ON public.highlight_seen;
CREATE POLICY "highlight_seen: stamp own"
  ON public.highlight_seen FOR INSERT
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT ON public.highlight_seen TO authenticated;
