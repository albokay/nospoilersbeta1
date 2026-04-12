-- ============================================================
-- Debug helper: call from the app via supabase.rpc('debug_auth_context')
-- Returns what Postgres actually sees for the current request's JWT.
-- Drop this function after debugging is complete.
-- ============================================================

CREATE OR REPLACE FUNCTION debug_auth_context()
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT json_build_object(
    'uid',             auth.uid(),
    'role',            auth.role(),
    'jwt_claims',      current_setting('request.jwt.claims',      true),
    'jwt_claim_sub',   current_setting('request.jwt.claim.sub',   true),
    'jwt_claim_role',  current_setting('request.jwt.claim.role',  true)
  )
$$;
