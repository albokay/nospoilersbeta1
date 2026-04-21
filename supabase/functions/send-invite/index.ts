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
const FROM_ADDRESS       = "Sidebar <invites@sidebar.watch>";

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

    // ── Look up show name for the email copy ─────────────────────────────────
    // Authoritative source is the shows table — avoids relying on whatever
    // the client happened to have in React state when it fired the request.
    // Best-effort: if the lookup fails (show row missing, race with TVMaze
    // sync, etc.), fall back to the generic "a show" phrasing in the
    // template. Not worth blocking the invite over.
    let showName: string | null = null;
    try {
      const { data: showRow } = await admin
        .from("shows")
        .select("name")
        .eq("id", grp.show_id)
        .single();
      if (showRow?.name) showName = showRow.name;
    } catch {
      // swallow — template handles null
    }

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

    const baseUrl    = (appUrl ?? "https://beta.sidebar.watch").replace(/\/$/, "");
    const inviteUrl  = `${baseUrl}/invite/${token}`;
    const sender     = inviterName ?? "Someone";
    // showName is looked up server-side above; fall back to generic phrasing
    // if the lookup failed so the email still renders cleanly.
    const showLabel  = showName?.trim() || "a show";
    const subject    = `${sender} invited you to watch ${showLabel} together on Sidebar`;

    // Email HTML: plain white body (Gmail was stripping the canon-light-blue
    // bg on the body element anyway, and the user prefers the white look).
    // Centered content column with comfortable padding. All styling inline
    // for cross-client compatibility (Gmail / Outlook / Apple Mail). Heading
    // in canon-dark-blue; CTA button canon-yellow. 📺 emoji avoids the
    // SVG-icon cross-client problem.
    const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:56px 32px">
  <h1 style="margin:0 0 24px;font-size:22px;color:#1a2c3a;font-weight:800;line-height:1.35">
    📺 <strong>${sender}</strong> has started a friend room on Sidebar to discuss <strong>${showLabel}</strong>. They want you to join!
  </h1>
  <p style="margin:0 0 20px;font-size:15px;color:#1a2c3a;line-height:1.55">
    Sidebar is a place where friends can have ongoing conversations about the TV shows they're watching, without worrying about spoilers. Everything gets filtered by your watch progress. Your friend room is called &ldquo;${groupName}.&rdquo;
  </p>
  <p style="margin:0 0 28px;font-size:15px;color:#1a2c3a;font-style:italic">
    talk. together. whenever.
  </p>
  <a href="${inviteUrl}"
     style="display:inline-block;background:#dea838;color:#fff;text-decoration:none;
            padding:12px 28px;border-radius:999px;font-size:15px;font-weight:700">
    Accept invitation →
  </a>
  <p style="margin:32px 0 0;font-size:12px;color:rgba(26,44,58,0.6);line-height:1.6">
    This link expires in 48 hours and can only be used once.<br>
    New to Sidebar? You'll be able to create an account when you accept.<br>
    If you weren't expecting this, you can safely ignore it.
  </p>
</div>
</body>
</html>`;

    const text = `${sender} has started a friend room on Sidebar to discuss ${showLabel}. They want you to join!\n\nSidebar is a place where friends can have ongoing conversations about the TV shows they're watching, without worrying about spoilers. Everything gets filtered by your watch progress. Your friend room is called "${groupName}."\n\ntalk. together. whenever.\n\nAccept here: ${inviteUrl}\n\nThis link expires in 48 hours and can only be used once.\nNew to Sidebar? You'll be able to create an account when you accept.\nIf you weren't expecting this, you can safely ignore it.`;

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

