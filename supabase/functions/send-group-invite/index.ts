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
// Calls the service-role check_rate_limit_for / check_rate_limit_daily_for RPCs
// (supabase/migrations/20260630_rate_limit_for_service_role.sql) via the admin
// client, passing the JWT-verified caller id. The auth.uid() variants can't be
// reached from a user-scoped client in the edge runtime ("Auth session
// missing!"). Fail-OPEN on an unexpected RPC error so a transient DB hiccup
// never blocks a legitimate invite; the limit still holds in normal operation.
async function rateOk(client: SupabaseClient, userId: string, action: string, maxCount: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await client.rpc("check_rate_limit_for", {
    p_user_id: userId, action_name: action, max_count: maxCount, window_seconds: windowSeconds,
  });
  if (error) { console.error("rate_limit check failed:", action, error.message); return true; }
  return data !== false;
}
async function dailyOk(client: SupabaseClient, userId: string, action: string, maxDaily: number): Promise<boolean> {
  const { data, error } = await client.rpc("check_rate_limit_daily_for", {
    p_user_id: userId, action_name: action, max_daily: maxDaily,
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

const FROM_ADDRESS = '"Sidebar (no reply)" <invites@sidebar.watch>';

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

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("invalid_body", 400);
    const { token, appUrl, displayName, nudge, message } = body as Record<string, string | boolean>;
    if (!token || typeof token !== "string") return jsonError("missing_fields", 400);
    // Nudge mode (pending-invites changeset): a follow-up email with the
    // inviter's own (editable) text. Creator-only; resets the invite's
    // silence clock + renews expiry on a successful send.
    const isNudge = nudge === true;
    const nudgeMessage = typeof message === "string" ? message.trim().slice(0, 500) : "";
    if (isNudge && !nudgeMessage) return jsonError("missing_fields", 400, "A nudge needs a message.");
    // Legacy "hi, it's…" typed name — post-CP4 clients no longer send it; a
    // stale pre-CP4 bundle still might. Used only as a fallback below when
    // the inviter has no display_name (shouldn't happen post-backfill).
    const customName = (displayName || "").trim().slice(0, 40);

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

    // Nudges are creator-only — you can only nudge YOUR invites (Alborz).
    if (isNudge && inv.created_by !== user.id) return jsonError("not_yours", 403);

    // ── Inviter's name (first-name identity CP4) ─────────────────────────────
    // The inviter is introduced by their self-chosen first name
    // (profiles.display_name). Chain: display_name → legacy typed name (stale
    // pre-CP4 clients only) → @handle. NOTE: the profile is the INVITE
    // CREATOR's (inv.created_by), matching the name the accepter's contact
    // seeding attaches to.
    let inviterHandle = "";
    let inviterFirstName = "";
    try {
      const { data: p } = await admin.from("profiles").select("username, display_name").eq("id", inv.created_by).maybeSingle();
      inviterHandle = p?.username ?? "";
      inviterFirstName = (p?.display_name ?? "").trim();
    } catch { /* generic fallback below */ }
    const senderName = inviterFirstName || customName || (inviterHandle ? `@${inviterHandle}` : "A friend");

    // Persist the resolved name on the invite so the welcome screen
    // (get_people_group_invitation) shows it and accept-time contact seeding
    // (accept_people_group_invitation) attaches it — both read
    // inviter_display_name, unchanged. Never persist the bare-@ fallback.
    const persistName = inviterFirstName || customName;
    if (persistName) {
      await admin.from("people_group_invitations").update({ inviter_display_name: persistName }).eq("token", token);
    }

    // ── Rate limit ───────────────────────────────────────────────────────────
    // Cap re-sends of this specific invite (3 / 24h) + a global per-user daily
    // email backstop (30 / 24h, shared key across all email-sending functions).
    if (!(await rateOk(admin, user.id, `grp_invite_send:${token}`, 3, 86400))) {
      return jsonError("rate_limit", 429, "You've re-sent this invite a few times today. Try again tomorrow.");
    }
    if (!(await dailyOk(admin, user.id, "email_action", 30))) {
      return jsonError("rate_limit", 429, "You've sent a lot of emails today. Try again tomorrow.");
    }

    // ── The inviter's just-wait-ep4 answer (onboarding changeset §6) ─────────
    // The headline leads with the inviter's OWN yes/no on the card the
    // invitee's wave 1 opens on — the click continues the email. Fallback
    // (inviter hasn't answered it yet — pre-catch-up accounts): the old
    // static headline, no "Do you?" line.
    let ep4: boolean | null = null;
    try {
      const { data: a } = await admin
        .from("deck_answers")
        .select("answer")
        .eq("user_id", inv.created_by)
        .eq("card_id", "just-wait-ep4")
        .maybeSingle();
      ep4 = a ? (a.answer as boolean) : null;
    } catch { /* fallback headline */ }

    // ── Send via Resend ──────────────────────────────────────────────────────
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not configured");

    const baseUrl   = (typeof appUrl === "string" ? appUrl : "https://beta.sidebar.watch").replace(/\/$/, "");
    const inviteUrl = `${baseUrl}/group-invite/${token}`;
    const email     = (inv.invitee_email as string).toLowerCase().trim();
    const subject   = isNudge
      ? `${senderName} still hopes you'll join them on Sidebar.`
      : `${senderName} invited you to a watch group on Sidebar`;

    // Nudge email: the inviter's own text (escaped, line breaks kept), then
    // the Join in → button — the link is never part of the editable text so
    // it can't be mangled. Fine print unchanged (expiry is renewed below).
    const nudgeBodyHtml = escapeHtml(nudgeMessage).replace(/\n/g, "<br>");

    // Onboarding changeset §6: dynamic headline on the inviter's yes/no;
    // "Do you?" rides only the dynamic variants; body drops the old closing
    // sentence; tagline removed; CTA = "Join in →". Fine print unchanged.
    const headlineHtml = ep4 === null
      ? `📺 <strong>${escapeHtml(senderName)}</strong> wants to watch shows with you on Sidebar.`
      : `📺 <strong>${escapeHtml(senderName)}</strong> thinks that &ldquo;just wait for episode 4&rdquo; when discussing TV ${ep4 ? "counts as a spoiler" : "is not a spoiler"}.`;
    const headlineText = ep4 === null
      ? `${senderName} wants to watch shows with you on Sidebar.`
      : `${senderName} thinks that "just wait for episode 4" when discussing TV ${ep4 ? "counts as a spoiler" : "is not a spoiler"}.`;
    const doYouHtml = ep4 === null ? "" : `\n  <p style="margin:0 0 20px;font-size:15px;color:#1a2c3a;font-weight:700">Do you?</p>`;
    const doYouText = ep4 === null ? "" : `\n\nDo you?`;

    const finePrintHtml = `
  <p style="margin:32px 0 0;font-size:12px;color:rgba(26,44,58,0.6);line-height:1.6">
    This link expires in a week and can only be used once.<br>
    New to Sidebar? You'll be able to create an account when you join.<br>
    If you weren't expecting this, you can safely ignore it.
  </p>`;
    const finePrintText = `This link expires in a week and can only be used once.\nNew to Sidebar? You'll be able to create an account when you join.\nIf you weren't expecting this, you can safely ignore it.`;
    const ctaHtml = `
  <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#dea838;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:15px;font-weight:700">
    Join in →
  </a>`;

    const html = isNudge
      ? `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:56px 32px">
  <p style="margin:0 0 28px;font-size:15px;color:#1a2c3a;line-height:1.55">
    ${nudgeBodyHtml}
  </p>${ctaHtml}${finePrintHtml}
</div>
</body>
</html>`
      : `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:56px 32px">
  <h1 style="margin:0 0 24px;font-size:22px;color:#1a2c3a;font-weight:800;line-height:1.35">
    ${headlineHtml}
  </h1>${doYouHtml}
  <p style="margin:0 0 28px;font-size:15px;color:#1a2c3a;line-height:1.55">
    Sidebar lets friends have ongoing, spoiler-safe conversations about the TV they're watching — everything is filtered by each person's watch progress, so you can say what you actually think.
  </p>${ctaHtml}${finePrintHtml}
</div>
</body>
</html>`;

    const text = isNudge
      ? `${nudgeMessage}\n\nJoin in: ${inviteUrl}\n\n${finePrintText}`
      : `${headlineText}${doYouText}\n\nSidebar lets friends have ongoing, spoiler-safe conversations about the TV they're watching — everything is filtered by each person's watch progress, so you can say what you actually think.\n\nJoin in: ${inviteUrl}\n\n${finePrintText}`;

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

    // A DELIVERED nudge resets the silence clock and renews the link (the
    // email just sent must work for a week). Failed sends skip this — the
    // stale signal should keep pointing at a nudge that never went out.
    if (isNudge) {
      await admin
        .from("people_group_invitations")
        .update({
          last_nudged_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
        })
        .eq("token", token);
    }
    return jsonOk({});

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-group-invite error:", msg);
    return jsonError("internal", 500, msg);
  }
});
