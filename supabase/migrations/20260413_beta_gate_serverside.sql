-- Server-side beta gate: hashed password + RPC check
-- =============================================================
-- 1. Ensure pgcrypto is available
-- =============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- =============================================================
-- 2. beta_config table (single-row, stores bcrypt hash)
-- =============================================================
CREATE TABLE IF NOT EXISTS beta_config (
  id   boolean PRIMARY KEY DEFAULT true CHECK (id), -- guarantees single row
  hash text    NOT NULL
);

-- Insert the hashed password.
-- >>> CHANGE 'CHANGE_ME' to your real beta password before running. <<<
INSERT INTO beta_config (hash)
VALUES (extensions.crypt('CHANGE_ME', extensions.gen_salt('bf')));

-- =============================================================
-- 3. RLS: table is completely locked — no policy grants access
-- =============================================================
ALTER TABLE beta_config ENABLE ROW LEVEL SECURITY;
-- (no SELECT / INSERT / UPDATE / DELETE policies created)

-- =============================================================
-- 4. RPC: check_beta_password  (SECURITY DEFINER — bypasses RLS)
-- =============================================================
CREATE OR REPLACE FUNCTION check_beta_password(attempt text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM beta_config
    WHERE hash = extensions.crypt(attempt, hash)
  );
$$;
