// ============================================================
// Supabase Edge Function: delete-account
// POST {}   Authorization: Bearer <user-jwt>
//
// Self-serve account deletion (ANONYMIZE model):
//   1. Verifies the caller's JWT.
//   2. Calls anonymize_own_account() with the caller's token (so auth.uid()
//      resolves) — this atomically strips PII + personal state, hard-deletes
//      private writing, and detaches/anonymizes shared-room writing to
//      "[deleted]". See migration 20260630_anonymize_own_account.sql.
//   3. Scrubs the auth.users identity via the Admin API: email -> dead
//      placeholder, password -> random, login banned. The row is KEPT (not
//      deleted) to avoid the large ON DELETE CASCADE blast radius on auth.users
//      (people_groups.created_by, group_messages, polls, etc.).
//
// The frontend signs the user out after a successful response.
//
// Env (auto): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
// config.toml: verify_jwt = false — this function verifies the JWT itself
// (project uses ES256 keys the gateway can't verify).
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://beta.sidebar.watch",
  "http://localhost:5173",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://beta.sidebar.watch";
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary":                         "Origin",
  };
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const jsonOk = (body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: true, ...body }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  const jsonError = (code: string, status: number, message?: string) =>
    new Response(JSON.stringify({ ok: false, error: code, ...(message ? { message } : {}) }), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonError("method_not_allowed", 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("missing_auth", 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !user) return jsonError("unauthorized", 401, authErr?.message);

    // ── 1. Anonymize public-schema data (atomic) ────────────────────────────
    // Called via the service-role admin client with the JWT-verified caller id.
    // The function is SECURITY DEFINER + granted to service_role only, so this
    // is the only path that can invoke it, and only for the verified caller.
    const { error: rpcErr } = await admin.rpc("anonymize_own_account", { p_user_id: user.id });
    if (rpcErr) return jsonError("anonymize_failed", 500, rpcErr.message);

    // ── 2. Scrub the auth identity + disable login (Admin API) ──────────────
    // Runs AFTER anonymization so a failure here leaves a re-runnable state
    // (the function is idempotent) rather than a locked-out, un-anonymized one.
    const randomPw = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
      email: `deleted+${user.id}@deleted.invalid`,
      email_confirm: true,       // set directly; never emails the placeholder
      password: randomPw,        // unknowable — password login dead
      user_metadata: {},         // drop any stored metadata (e.g. username)
      ban_duration: "876000h",   // ~100 years — login blocked outright
    });
    if (updErr) return jsonError("scrub_failed", 500, updErr.message);

    return jsonOk({});
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("delete-account error:", msg);
    return jsonError("internal", 500, msg);
  }
});
