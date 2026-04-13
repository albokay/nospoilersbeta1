-- Browse progress: silent, non-committed progress for public browsing
-- Stores watch progress for logged-in users who browse public conversations
-- without starting a journal or friend room. Used only to pre-populate
-- the progress selector on return visits.

CREATE TABLE IF NOT EXISTS browse_progress (
  user_id           uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  show_id           text         NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  season            int          NOT NULL DEFAULT 1,
  episode           int          NOT NULL DEFAULT 1,
  is_rewatching     boolean      NOT NULL DEFAULT false,
  rewatch_season    int,
  rewatch_episode   int,
  highest_season    int,
  highest_episode   int,
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, show_id)
);

ALTER TABLE browse_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own browse_progress"
  ON browse_progress FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
