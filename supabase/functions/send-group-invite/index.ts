// ============================================================
// Supabase Edge Function: send-group-invite (restructure)
// POST { token, appUrl }
//   Authorization: Bearer <user-jwt>
//
// Emails an EXISTING people-group invitation (created by the
// create_people_group_invitation RPC). Separate from send-invite, which
// handles the legacy per-show friend rooms.
//
//   1. Verifies the caller is authenticated + a member of the invite's group
//   2. Looks up the invitee email + inviter/group names (service role)
//   3. Emails the /group-invite/<token> link via Resend
//
// Env (Supabase dashboard): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto),
// RESEND_API_KEY (manual). Add `verify_jwt = false` for this function in
// config.toml — it does its own JWT verification (ES256 keys).
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://beta.sidebar.watch",
  "http://localhost:5173",
]);

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Reuses the existing check_rate_limit / check_rate_limit_daily SECURITY DEFINER
// RPCs (supabase/migrations/20260413_rate_limiting.sql), which key on auth.uid().
// We call them on a USER-SCOPED client (anon key + the caller's JWT) so auth.uid()
// resolves to the caller — the service-role admin client has no user context.
// Fail-OPEN on an unexpected RPC error so a transient DB hiccup never blocks a
// legitimate invite; the limit still holds in normal operation.
async function rateOk(client: SupabaseClient, action: string, maxCount: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await client.rpc("check_rate_limit", {
    action_name: action, max_count: maxCount, window_seconds: windowSeconds,
  });
  if (error) { console.error("rate_limit check failed:", action, error.message); return true; }
  return data !== false;
}
async function dailyOk(client: SupabaseClient, action: string, maxDaily: number): Promise<boolean> {
  const { data, error } = await client.rpc("check_rate_limit_daily", {
    action_name: action, max_daily: maxDaily,
  });
  if (error) { console.error("daily_rate_limit check failed:", action, error.message); return true; }
  return data !== false;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://beta.sidebar.watch";
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary":                         "Origin",
  };
}

const FROM_ADDRESS = "Sidebar <invites@sidebar.watch>";

// Escape user-controlled values before interpolating into email HTML, so a
// crafted username / group name can't inject markup into the email body.
// (Matches the helper in send-message / send-digests.)
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const jsonOk = (body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: true, ...body }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  const jsonError = (code: string, status: number, message?: string) =>
    new Response(JSON.stringify({ ok: false, error: code, ...(message ? { message } : {}) }), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

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

    // User-scoped client for rate-limit RPCs (auth.uid() = caller).
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { autoRefreshToken: false, persistSession: false } },
    );

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("invalid_body", 400);
    const { token, appUrl } = body as Record<string, string>;
    if (!token) return jsonError("missing_fields", 400);

    // ── Look up the invitation ───────────────────────────────────────────────
    const { data: inv, error: invErr } = await admin
      .from("people_group_invitations")
      .select("people_group_id, invitee_email, created_by, accepted_at, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (invErr || !inv) return jsonError("invite_not_found", 404);
    if (inv.accepted_at) return jsonError("already_accepted", 409);

    // Caller must be a member of the group the invite is for.
    const { data: membership } = await admin
      .from("people_group_members")
      .select("user_id")
      .eq("group_id", inv.people_group_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return jsonError("not_member", 403);

    // ── Rate limit ───────────────────────────────────────────────────────────
    // Cap re-sends of this specific invite (3 / 24h) + a global per-user daily
    // email backstop (30 / 24h, shared key across all email-sending functions).
    if (!(await rateOk(userClient, `grp_invite_send:${token}`, 3, 86400))) {
      return jsonError("rate_limit", 429, "You've re-sent this invite a few times today. Try again tomorrow.");
    }
    if (!(await dailyOk(userClient, "email_action", 30))) {
      return jsonError("rate_limit", 429, "You've sent a lot of emails today. Try again tomorrow.");
    }

    // ── Names for the email copy ─────────────────────────────────────────────
    let inviterName = "A friend";
    try {
      const { data: p } = await admin.from("profiles").select("username").eq("id", inv.created_by).maybeSingle();
      if (p?.username) inviterName = p.username;
    } catch { /* generic fallback */ }

    let groupLabel = "";
    try {
      const { data: g } = await admin.from("people_groups").select("name").eq("id", inv.people_group_id).maybeSingle();
      if (g?.name) groupLabel = g.name;
    } catch { /* unnamed */ }

    // ── Send via Resend ──────────────────────────────────────────────────────
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not configured");

    const baseUrl   = (appUrl ?? "https://beta.sidebar.watch").replace(/\/$/, "");
    const inviteUrl = `${baseUrl}/group-invite/${token}`;
    const email     = (inv.invitee_email as string).toLowerCase().trim();
    const groupBit  = groupLabel ? ` &ldquo;${escapeHtml(groupLabel)}&rdquo;` : "";
    const subject   = `${inviterName} invited you to a watch group on Sidebar`;

    const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:56px 32px">
  <h1 style="margin:0 0 24px;font-size:22px;color:#1a2c3a;font-weight:800;line-height:1.35">
    📺 <strong>${escapeHtml(inviterName)}</strong> wants to watch shows with you on Sidebar.
  </h1>
  <p style="margin:0 0 20px;font-size:15px;color:#1a2c3a;line-height:1.55">
    Sidebar lets friends have ongoing, spoiler-safe conversations about the TV they're watching — everything is filtered by each person's watch progress. They've invited you to their watch group${groupBit}.
  </p>
  <p style="margin:0 0 28px;font-size:15px;color:#1a2c3a;font-style:italic">talk. together. whenever.</p>
  <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#dea838;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:15px;font-weight:700">
    Join the group →
  </a>
  <p style="margin:32px 0 0;font-size:12px;color:rgba(26,44,58,0.6);line-height:1.6">
    This link expires in 48 hours and can only be used once.<br>
    New to Sidebar? You'll be able to create an account when you join.<br>
    If you weren't expecting this, you can safely ignore it.
  </p>
</div>
</body>
</html>`;

    const text = `${inviterName} wants to watch shows with you on Sidebar.\n\nSidebar lets friends have ongoing, spoiler-safe conversations about the TV they're watching — filtered by each person's watch progress. They've invited you to their watch group${groupLabel ? ` "${groupLabel}"` : ""}.\n\ntalk. together. whenever.\n\nJoin here: ${inviteUrl}\n\nThis link expires in 48 hours and can only be used once.\nNew to Sidebar? You'll be able to create an account when you join.\nIf you weren't expecting this, you can safely ignore it.`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [email], subject, html, text }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      console.error("Resend error:", detail);
      return jsonOk({ warning: "email_send_failed" });
    }
    return jsonOk({});

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-group-invite error:", msg);
    return jsonError("internal", 500, msg);
  }
});
