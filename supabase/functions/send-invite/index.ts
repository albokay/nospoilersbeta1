// ============================================================
// Supabase Edge Function: send-invite
// POST { groupId, inviteeEmail, groupName, inviterName, appUrl }
//   Authorization: Bearer <user-jwt>
//
// 1. Validates caller is authenticated + is the group creator
// 2. Rate-limits to 10 invites per user per 24 hours
// 3. Rejects duplicate pending invites for the same email+group
// 4. Creates the invitation row (service role, bypasses RLS)
// 5. Sends the invite email via Resend
//
// Environment variables required (set in Supabase dashboard):
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   RESEND_API_KEY            (add manually)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Browsers only honor Access-Control-Allow-Origin when it echoes the request's
// Origin exactly (or is "*"). We keep a small allowlist and echo the match
// back — covers prod + local dev without loosening security to a wildcard.
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

const RATE_LIMIT_PER_DAY = 10;
const FROM_ADDRESS       = "No Spoilers <invites@sidebar.watch>";

serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  // Closure so the helpers can reference the request-scoped cors headers
  // without threading them through every call site.
  const jsonOk = (body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: true, ...body }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  const jsonError = (code: string, status: number, message?: string) =>
    new Response(JSON.stringify({ ok: false, error: code, ...(message ? { message } : {}) }), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    // ── Authenticate caller ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("missing_auth", 401);

    // Service-role client for all DB writes (bypasses RLS)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify the JWT using the admin client (most reliable in Edge Functions)
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !user) return jsonError("unauthorized", 401, authErr?.message);

    // ── Parse + validate input ───────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("invalid_body", 400);

    const { groupId, inviteeEmail, groupName, inviterName, appUrl } = body as Record<string, string>;
    if (!groupId || !inviteeEmail || !groupName) {
      return jsonError("missing_fields", 400);
    }

    const email = inviteeEmail.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError("invalid_email", 400);
    }

    // ── Block self-invite ────────────────────────────────────────────────────
    // The user's own email isn't a useful invite target — accepting it would
    // be a no-op (they're already in the group as creator/member). Reject
    // here so we don't waste an invitation row + email send on a mistake.
    const callerEmail = user.email?.toLowerCase().trim();
    if (callerEmail && email === callerEmail) {
      return jsonError("self_invite", 400, "You can't invite yourself.");
    }

    // ── Verify caller is the group creator ───────────────────────────────────
    const { data: grp, error: grpErr } = await admin
      .from("friend_groups")
      .select("id, created_by, show_id")
      .eq("id", groupId)
      .single();
    if (grpErr || !grp)          return jsonError("group_not_found", 404);
    if (grp.created_by !== user.id) return jsonError("not_creator", 403);

    // ── Rate limit ───────────────────────────────────────────────────────────
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("invitations")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.id)
      .gte("created_at", since);

    if ((count ?? 0) >= RATE_LIMIT_PER_DAY) {
      return jsonError("rate_limit", 429, "You can send at most 10 invitations per 24 hours.");
    }

    // ── Reject duplicate pending invite ──────────────────────────────────────
    const { data: dup } = await admin
      .from("invitations")
      .select("id")
      .eq("group_id", groupId)
      .eq("invitee_email", email)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (dup) {
      return jsonError("already_invited", 409, "This email already has a pending invitation to this room.");
    }

    // ── Create the invitation row ────────────────────────────────────────────
    const token     = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const { error: invErr } = await admin
      .from("invitations")
      .insert({
        group_id:      groupId,
        created_by:    user.id,
        invitee_email: email,
        token,
        expires_at:    expiresAt,
      });
    if (invErr) throw invErr;

    // ── Send email via Resend ────────────────────────────────────────────────
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not configured");

    const baseUrl   = (appUrl ?? "https://nospoilers.app").replace(/\/$/, "");
    const inviteUrl = `${baseUrl}/invite/${token}`;
    const sender    = inviterName ?? "Someone";
    const subject   = `${sender} invited you to "${groupName}" on No Spoilers`;

    const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0e0e10;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:480px;margin:40px auto;padding:32px 28px;background:#18181b;border-radius:12px;border:1px solid rgba(255,255,255,0.08)">
  <p style="margin:0 0 4px;font-size:13px;color:#71717a;text-transform:uppercase;letter-spacing:0.08em">No Spoilers</p>
  <h1 style="margin:0 0 20px;font-size:24px;color:#fafafa;font-weight:700">You're invited 🎬</h1>
  <p style="margin:0 0 24px;font-size:15px;color:#a1a1aa;line-height:1.6">
    <strong style="color:#fafafa">${sender}</strong> invited you to join the private watch room
    <strong style="color:#fafafa">"${groupName}"</strong> — a spoiler-safe space to discuss episodes
    with friends as you watch.
  </p>
  <a href="${inviteUrl}"
     style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;
            padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600">
    Accept invitation →
  </a>
  <p style="margin:28px 0 0;font-size:12px;color:#52525b;line-height:1.6">
    This link expires in 48 hours and can only be used once.<br>
    If you weren't expecting this, you can safely ignore it.
  </p>
</div>
</body>
</html>`;

    const text = `${sender} invited you to join "${groupName}" on No Spoilers.\n\nAccept here: ${inviteUrl}\n\nThis link expires in 48 hours and can only be used once.\nIf you weren't expecting this, you can safely ignore it.`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [email], subject, html, text }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      console.error("Resend error:", detail);
      // The DB row was created — return success so the UI shows the pending invite.
      // The sender can copy the link manually as a fallback.
      return jsonOk({ warning: "email_send_failed" });
    }

    return jsonOk({});

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-invite error:", msg);
    return jsonError("internal", 500, msg);
  }
});

