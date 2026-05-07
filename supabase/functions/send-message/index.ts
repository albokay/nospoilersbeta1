// ============================================================
// Supabase Edge Function: send-message
// POST { template_type, recipient_id, group_id, message }
//   Authorization: Bearer <user-jwt>
//
// Round 1 handles three template_types — the three direction-based
// pings. Polls + SIKW templates will be added in later rounds.
//
// For ALL three ping types:
//   1. Verify caller JWT
//   2. Validate request body
//   3. Validate sender (caller) ≠ recipient
//   4. Validate sender + recipient are both current members of group_id
//   5. Look up the group's show_id (server-side; never trust client)
//   6. Check 7-day rate limit per (sender, recipient, group)
//   7. INSERT ping row (service role bypasses RLS)
//
// For nudge_ahead ONLY (email channel):
//   8. Send Resend email — embeds the message in the body, drops the
//      📺 emoji that send-invite uses (per spec: pings feel less formal)
//   9. ping row's `message` column is NULL (email already delivered it)
//
// For nudge_same / nudge_behind (sticky channel):
//   8. Skip Resend
//   9. ping row's `message` column is populated (the in-room sticky
//      reads it)
//
// Environment variables required (set in Supabase dashboard):
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   RESEND_API_KEY            (already set; reused from send-invite)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS allowlist. Add the Netlify branch deploy URL when known.
const ALLOWED_ORIGINS = new Set([
  "https://beta.sidebar.watch",
  "http://localhost:5173",
  // TODO add the pings-polls branch deploy URL once it's live, e.g.:
  //   "https://pings-polls--<sitename>.netlify.app",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://beta.sidebar.watch";
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary":                         "Origin",
  };
}

const RATE_LIMIT_WINDOW_DAYS = 7;
const MESSAGE_MAX_LENGTH     = 80;
const FROM_ADDRESS           = "Sidebar <invites@sidebar.watch>";

const VALID_TEMPLATE_TYPES = new Set(["nudge_ahead", "nudge_same", "nudge_behind"]);

serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

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

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    // ── 1. Authenticate caller ───────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("missing_auth", 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !user) return jsonError("unauthorized", 401, authErr?.message);

    // ── 2. Parse + validate body ─────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("invalid_body", 400);

    const { template_type, recipient_id, group_id, message } = body as Record<string, string>;
    if (!template_type || !recipient_id || !group_id || message == null) {
      return jsonError("missing_fields", 400);
    }
    if (!VALID_TEMPLATE_TYPES.has(template_type)) {
      return jsonError("invalid_template_type", 400);
    }

    const trimmedMessage = String(message).trim();
    if (trimmedMessage.length === 0) {
      return jsonError("invalid_message", 400, "Message can't be empty.");
    }
    if (trimmedMessage.length > MESSAGE_MAX_LENGTH) {
      return jsonError("invalid_message", 400, `Message exceeds ${MESSAGE_MAX_LENGTH} characters.`);
    }

    // ── 3. Self-ping guard ───────────────────────────────────────────────
    // CHECK constraint also enforces this; this gives a cleaner error.
    if (recipient_id === user.id) {
      return jsonError("self_ping", 400, "You can't ping yourself.");
    }

    // ── 4. Membership: sender + recipient both current members of group ─
    // friend_group_departed_members is a separate trail; current
    // membership is friend_group_members. Two rows expected (sender +
    // recipient), or we reject.
    const { data: members, error: memErr } = await admin
      .from("friend_group_members")
      .select("user_id")
      .eq("group_id", group_id)
      .in("user_id", [user.id, recipient_id]);
    if (memErr) return jsonError("internal", 500, memErr.message);
    const memberIds = new Set((members ?? []).map((m: { user_id: string }) => m.user_id));
    if (!memberIds.has(user.id) || !memberIds.has(recipient_id)) {
      return jsonError("not_member", 403, "Sender and recipient must both be current members of this room.");
    }

    // ── 5. Look up group's show_id (server-side authoritative) ───────────
    const { data: grp, error: grpErr } = await admin
      .from("friend_groups")
      .select("show_id, name, deleted_at")
      .eq("id", group_id)
      .single();
    if (grpErr || !grp) return jsonError("group_not_found", 404);
    if (grp.deleted_at) return jsonError("group_not_found", 404);

    // ── 6. Rate limit: 7 days per (sender, recipient, group) ─────────────
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("pings")
      .select("id")
      .eq("sender_id", user.id)
      .eq("recipient_id", recipient_id)
      .eq("group_id", group_id)
      .gt("sent_at", since)
      .limit(1)
      .maybeSingle();
    if (recent) {
      return jsonError("rate_limit", 429, "You've already pinged this friend in this room recently.");
    }

    // ── 7. INSERT ping row ───────────────────────────────────────────────
    // message column rule (application-level, not DB-enforced):
    //   nudge_ahead → NULL (content goes in the email)
    //   nudge_same / nudge_behind → store the message (sticky reads it)
    const persistedMessage = template_type === "nudge_ahead" ? null : trimmedMessage;

    const { data: insertedPing, error: insErr } = await admin
      .from("pings")
      .insert({
        sender_id:    user.id,
        recipient_id: recipient_id,
        show_id:      grp.show_id,
        group_id:     group_id,
        ping_type:    template_type,
        message:      persistedMessage,
      })
      .select("id")
      .single();
    if (insErr || !insertedPing) {
      return jsonError("internal", 500, insErr?.message ?? "insert failed");
    }

    // ── 8. Email send (nudge_ahead only) ─────────────────────────────────
    if (template_type !== "nudge_ahead") {
      return jsonOk({ ping_id: insertedPing.id, channel: "sticky" });
    }

    // From here on we're sending an email. Look up the pieces we need:
    // recipient's email, sender's @username, show name. All best-effort
    // with sensible fallbacks — we'd rather send a slightly-degraded
    // email than block the ping.

    // Recipient email
    const { data: rcptUser, error: rcptErr } = await admin.auth.admin.getUserById(recipient_id);
    if (rcptErr || !rcptUser?.user?.email) {
      // Row already inserted; the rate-limit signal stands. Return a
      // warning so the UI can surface "delivered to room only" without
      // failing the user's action.
      console.warn("Recipient email lookup failed:", rcptErr?.message ?? "no email");
      return jsonOk({ ping_id: insertedPing.id, channel: "sticky", warning: "no_recipient_email" });
    }
    const recipientEmail = rcptUser.user.email;

    // Sender's @username (from profiles)
    const { data: senderProfile } = await admin
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();
    const senderHandle = senderProfile?.username || "a friend";

    // Show name (from shows via group's show_id)
    const { data: showRow } = await admin
      .from("shows")
      .select("name")
      .eq("id", grp.show_id)
      .single();
    const showName = showRow?.name?.trim() || "a show";
    const roomName = grp.name?.trim() || "your room";

    // Build email
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("RESEND_API_KEY not configured");
      return jsonOk({ ping_id: insertedPing.id, channel: "sticky", warning: "email_not_configured" });
    }

    const baseUrl = (Deno.env.get("APP_URL") ?? "https://beta.sidebar.watch").replace(/\/$/, "");
    const roomUrl = `${baseUrl}/show/${encodeURIComponent(grp.show_id)}`;
    const subject = `@${senderHandle} sent you a nudge about ${showName}`;

    // No 📺 emoji per spec — pings feel less formal than friend invites.
    const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:56px 32px">
  <h1 style="margin:0 0 24px;font-size:22px;color:#1a2c3a;font-weight:800;line-height:1.35">
    @${escapeHtml(senderHandle)} wants you in the room.
  </h1>
  <p style="margin:0 0 20px;font-size:15px;color:#1a2c3a;line-height:1.55">
    Your friend room for <strong><em>${escapeHtml(showName)}</em></strong> &mdash; &ldquo;${escapeHtml(roomName)}&rdquo; &mdash; has been piling up takes. @${escapeHtml(senderHandle)} sent you a little nudge:
  </p>
  <p style="margin:0 0 28px;padding:16px 20px;background:#f6f4ee;border-left:3px solid #1a2c3a;font-size:16px;color:#1a2c3a;font-style:italic;line-height:1.5">
    ${escapeHtml(trimmedMessage)}
  </p>
  <a href="${roomUrl}"
     style="display:inline-block;background:#dea838;color:#fff;text-decoration:none;
            padding:12px 28px;border-radius:999px;font-size:15px;font-weight:700">
    Open the room →
  </a>
  <p style="margin:28px 0 0;font-size:14px;color:#1a2c3a;font-style:italic">
    no rush. when you're ready.
  </p>
  <p style="margin:32px 0 0;font-size:12px;color:rgba(26,44,58,0.6);line-height:1.6">
    You're getting this because you're in a friend room with @${escapeHtml(senderHandle)} on Sidebar.
  </p>
</div>
</body>
</html>`;

    const text = `@${senderHandle} wants you in the room.

Your friend room for ${showName} — "${roomName}" — has been piling up takes. @${senderHandle} sent you a little nudge:

  ${trimmedMessage}

Open the room: ${roomUrl}

no rush. when you're ready.

You're getting this because you're in a friend room with @${senderHandle} on Sidebar.`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [recipientEmail], subject, html, text }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      console.error("Resend error:", detail);
      // Ping row exists — rate limit will work. Return success with a
      // warning the UI can surface. Mirrors send-invite's behavior.
      return jsonOk({ ping_id: insertedPing.id, channel: "email", warning: "email_send_failed" });
    }

    return jsonOk({ ping_id: insertedPing.id, channel: "email" });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-message error:", msg);
    return jsonError("internal", 500, msg);
  }
});

// Minimal HTML-entity escaping for the four characters that matter in
// content interpolation. Keeps the email body safe against a sender or
// recipient whose handle contains < > & or quote characters.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
