// ============================================================
// Supabase Edge Function: send-message
// POST { template_type, ...rest depending on template_type }
//   Authorization: Bearer <user-jwt>
//
// Six templates (round 1 + round 2):
//
//   Pings (round 1):
//     nudge_ahead             — email channel; persists ping row, sends email
//     nudge_same              — sticky channel; persists ping row, no email
//     nudge_behind            — sticky channel; persists ping row, no email
//
//   Polls (round 2):
//     poll_invite             — asker → all non-asker members. No row write
//                               (the poll itself is the row); fires N emails.
//     poll_close              — to asker only when poll closes. Fires after
//                               vote_on_poll RPC returns did_close=true.
//     poll_vote_notification  — to asker, with 5-min batching window per
//                               poll. Skipped silently if last notification
//                               was < 5 min ago.
//
// Body shape per template:
//   nudge_*:   { template_type, recipient_id, group_id, message }
//   poll_*:    { template_type, poll_id }
//
// Environment variables required:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   RESEND_API_KEY            (manual; reused from send-invite)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS allowlist.
const ALLOWED_ORIGINS = new Set([
  "https://beta.sidebar.watch",
  "http://localhost:5173",
  // pings-polls branch preview deploy (Vercel)
  "https://nospoilersbeta1-git-pings-polls-albokays-projects.vercel.app",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://beta.sidebar.watch";
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary":                         "Origin",
  };
}

// ── Constants ────────────────────────────────────────────────────────────

// One ping per (sender, recipient, room) per 24 hours.
// Must stay in sync with PING_RATE_LIMIT_ENABLED in src/lib/db.ts.
const PING_RATE_LIMIT_ENABLED            = true;
const PING_RATE_LIMIT_WINDOW_HOURS       = 24;
const MESSAGE_MAX_LENGTH                 = 80;
const FROM_ADDRESS                       = "Sidebar <invites@sidebar.watch>";
const POLL_VOTE_NOTIFICATION_BATCH_MIN   = 5;

const PING_TEMPLATES = new Set(["nudge_ahead", "nudge_same", "nudge_behind"]);
const POLL_TEMPLATES = new Set(["poll_invite", "poll_close", "poll_vote_notification"]);
const SIKW_TEMPLATES = new Set(["sikw_ask_invite", "sikw_reply"]);

// Type alias to keep handler signatures readable.
// deno-lint-ignore no-explicit-any
type AdminClient = any;

// ── Top-level dispatch ───────────────────────────────────────────────────

serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));

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
    // Auth — same for all templates.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("missing_auth", 401);

    const admin: AdminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !user) return jsonError("unauthorized", 401, authErr?.message);

    // Body parse + template_type validation.
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("invalid_body", 400);

    const template_type = (body as Record<string, string>).template_type;
    if (!template_type
        || (!PING_TEMPLATES.has(template_type)
            && !POLL_TEMPLATES.has(template_type)
            && !SIKW_TEMPLATES.has(template_type))) {
      return jsonError("invalid_template_type", 400);
    }

    // Dispatch.
    if (PING_TEMPLATES.has(template_type)) {
      return await handlePing(body, user, admin, jsonOk, jsonError);
    }
    if (POLL_TEMPLATES.has(template_type)) {
      return await handlePoll(body, user, admin, jsonOk, jsonError);
    }
    if (SIKW_TEMPLATES.has(template_type)) {
      return await handleSikw(body, user, admin, jsonOk, jsonError);
    }
    return jsonError("invalid_template_type", 400);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-message error:", msg);
    return jsonError("internal", 500, msg);
  }
});

// ── Pings ────────────────────────────────────────────────────────────────
// Round-1 logic, unchanged in behavior. Validates membership, rate-limits
// (kill switch), inserts ping row, sends email iff nudge_ahead.

async function handlePing(
  body: Record<string, unknown>,
  user: { id: string; email?: string },
  admin: AdminClient,
  jsonOk: (b: Record<string, unknown>) => Response,
  jsonError: (code: string, status: number, message?: string) => Response,
): Promise<Response> {
  const { template_type, recipient_id, group_id, message } = body as Record<string, string>;

  if (!recipient_id || !group_id || message == null) {
    return jsonError("missing_fields", 400);
  }

  const trimmedMessage = String(message).trim();
  if (trimmedMessage.length === 0) {
    return jsonError("invalid_message", 400, "Message can't be empty.");
  }
  if (trimmedMessage.length > MESSAGE_MAX_LENGTH) {
    return jsonError("invalid_message", 400, `Message exceeds ${MESSAGE_MAX_LENGTH} characters.`);
  }

  if (recipient_id === user.id) {
    return jsonError("self_ping", 400, "You can't ping yourself.");
  }

  // Membership: sender + recipient both current members of group_id.
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

  // Look up group's show_id (server-side authoritative).
  const { data: grp, error: grpErr } = await admin
    .from("friend_groups")
    .select("show_id, name, deleted_at")
    .eq("id", group_id)
    .single();
  if (grpErr || !grp) return jsonError("group_not_found", 404);
  if (grp.deleted_at) return jsonError("group_not_found", 404);

  // Rate limit (kill switch).
  if (PING_RATE_LIMIT_ENABLED) {
    const since = new Date(Date.now() - PING_RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
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
      return jsonError("rate_limit", 429, "You've already pinged this friend in this room today.");
    }
  }

  // Insert ping row. Persist the message for every ping_type so the
  // recipient sees an in-room sticky regardless of channel — nudge_ahead
  // also still triggers the email below.
  const persistedMessage = trimmedMessage;

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

  // Email send (nudge_ahead only).
  if (template_type !== "nudge_ahead") {
    return jsonOk({ ping_id: insertedPing.id, channel: "sticky" });
  }

  const { data: rcptUser, error: rcptErr } = await admin.auth.admin.getUserById(recipient_id);
  if (rcptErr || !rcptUser?.user?.email) {
    console.warn("Recipient email lookup failed:", rcptErr?.message ?? "no email");
    return jsonOk({ ping_id: insertedPing.id, channel: "sticky", warning: "no_recipient_email" });
  }
  const recipientEmail = rcptUser.user.email;

  const { data: senderProfile } = await admin
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();
  const senderHandle = senderProfile?.username || "a friend";

  const { data: showRow } = await admin
    .from("shows")
    .select("name")
    .eq("id", grp.show_id)
    .single();
  const showName = showRow?.name?.trim() || "a show";
  const roomName = grp.name?.trim() || "your room";

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("RESEND_API_KEY not configured");
    return jsonOk({ ping_id: insertedPing.id, channel: "sticky", warning: "email_not_configured" });
  }

  const baseUrl = (Deno.env.get("APP_URL") ?? "https://beta.sidebar.watch").replace(/\/$/, "");
  const roomUrl = `${baseUrl}/show/${encodeURIComponent(grp.show_id)}`;
  const subject = `@${senderHandle} sent you a nudge about ${showName}`;

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
  <a href="${roomUrl}" style="display:inline-block;background:#dea838;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:15px;font-weight:700">
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

  const sent = await sendResendEmail(resendKey, recipientEmail, subject, html, text);
  if (!sent) {
    return jsonOk({ ping_id: insertedPing.id, channel: "email", warning: "email_send_failed" });
  }
  return jsonOk({ ping_id: insertedPing.id, channel: "email" });
}

// ── Polls ────────────────────────────────────────────────────────────────
// Three sub-templates. All take { template_type, poll_id }. Each branches
// to its own handler. None write the poll/option/response rows — those
// happen via the open_poll / vote_on_poll RPCs from phase 2a. This
// function is email-only for polls.

async function handlePoll(
  body: Record<string, unknown>,
  user: { id: string; email?: string },
  admin: AdminClient,
  jsonOk: (b: Record<string, unknown>) => Response,
  jsonError: (code: string, status: number, message?: string) => Response,
): Promise<Response> {
  const { template_type, poll_id } = body as Record<string, string>;
  if (!poll_id) return jsonError("missing_fields", 400);

  // Common lookup: poll + group + show + asker email + asker handle.
  const { data: poll, error: pollErr } = await admin
    .from("polls")
    .select("id, asker_id, group_id, question, allow_write_in, duration, created_at, closed_at, last_vote_notification_at")
    .eq("id", poll_id)
    .single();
  if (pollErr || !poll) return jsonError("poll_not_found", 404);

  const { data: grp } = await admin
    .from("friend_groups")
    .select("name, show_id, deleted_at")
    .eq("id", poll.group_id)
    .single();
  if (!grp || grp.deleted_at) return jsonError("group_not_found", 404);

  const { data: showRow } = await admin
    .from("shows")
    .select("name")
    .eq("id", grp.show_id)
    .single();
  const showName = showRow?.name?.trim() || "a show";
  const roomName = grp.name?.trim() || "your room";

  if (template_type === "poll_invite") {
    return await handlePollInvite(poll, grp, showName, roomName, user, admin, jsonOk, jsonError);
  }
  if (template_type === "poll_close") {
    return await handlePollClose(poll, showName, roomName, user, admin, jsonOk, jsonError);
  }
  if (template_type === "poll_vote_notification") {
    return await handlePollVoteNotification(poll, grp, showName, roomName, user, admin, jsonOk, jsonError);
  }
  return jsonError("invalid_template_type", 400);
}

// ── poll_invite ──────────────────────────────────────────────────────────

async function handlePollInvite(
  poll: { id: string; asker_id: string; group_id: string; question: string; duration: string; created_at: string },
  grp: { show_id: string },
  showName: string,
  roomName: string,
  user: { id: string },
  admin: AdminClient,
  jsonOk: (b: Record<string, unknown>) => Response,
  jsonError: (code: string, status: number, message?: string) => Response,
): Promise<Response> {
  // Only the asker can fire poll-invite emails.
  if (poll.asker_id !== user.id) {
    return jsonError("not_asker", 403);
  }

  const { data: askerProfile } = await admin
    .from("profiles")
    .select("username")
    .eq("id", poll.asker_id)
    .single();
  const askerHandle = askerProfile?.username || "a friend";

  // Recipients = current members minus asker.
  const { data: members } = await admin
    .from("friend_group_members")
    .select("user_id")
    .eq("group_id", poll.group_id);
  const recipientIds = (members ?? [])
    .map((m: { user_id: string }) => m.user_id)
    .filter((id: string) => id !== poll.asker_id);

  if (recipientIds.length === 0) {
    return jsonOk({ sent_count: 0, channel: "email" });
  }

  // Build expiration date string for the email body.
  const durationMs =
    poll.duration === "24h" ? 24 * 60 * 60 * 1000 :
    poll.duration === "3d"  ?  3 * 24 * 60 * 60 * 1000 :
                                7 * 24 * 60 * 60 * 1000;
  const closesAt = new Date(new Date(poll.created_at).getTime() + durationMs);
  const closesLabel = closesAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return jsonOk({ sent_count: 0, channel: "email", warning: "email_not_configured" });
  }

  const baseUrl = (Deno.env.get("APP_URL") ?? "https://beta.sidebar.watch").replace(/\/$/, "");
  const roomUrl = `${baseUrl}/show/${encodeURIComponent(grp.show_id)}`;
  const subject = `@${askerHandle} asked the room something about ${showName}`;

  let sentCount = 0;
  let failedCount = 0;

  for (const rid of recipientIds) {
    const { data: rcptUser } = await admin.auth.admin.getUserById(rid);
    const email = rcptUser?.user?.email;
    if (!email) {
      failedCount++;
      continue;
    }

    const html = pollInviteHtml(askerHandle, roomName, poll.question, closesLabel, roomUrl);
    const text = pollInviteText(askerHandle, roomName, poll.question, closesLabel, roomUrl);
    const sent = await sendResendEmail(resendKey, email, subject, html, text);
    if (sent) sentCount++; else failedCount++;
  }

  return jsonOk({ sent_count: sentCount, failed_count: failedCount, channel: "email" });
}

function pollInviteHtml(asker: string, room: string, question: string, closes: string, url: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:56px 32px">
  <h1 style="margin:0 0 24px;font-size:22px;color:#1a2c3a;font-weight:800;line-height:1.35">
    @${escapeHtml(asker)} has a question.
  </h1>
  <p style="margin:0 0 16px;font-size:15px;color:#1a2c3a;line-height:1.55">
    @${escapeHtml(asker)} opened a poll in &ldquo;${escapeHtml(room)}&rdquo;:
  </p>
  <p style="margin:0 0 24px;padding:16px 20px;background:#f6f4ee;border-left:3px solid #1a2c3a;font-size:16px;color:#1a2c3a;font-style:italic;line-height:1.5">
    "${escapeHtml(question)}"
  </p>
  <p style="margin:0 0 28px;font-size:15px;color:#1a2c3a;line-height:1.55">
    Drop in and weigh in. Open until ${escapeHtml(closes)}.
  </p>
  <a href="${url}" style="display:inline-block;background:#dea838;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:15px;font-weight:700">
    Answer the poll →
  </a>
  <p style="margin:28px 0 0;font-size:14px;color:#1a2c3a;font-style:italic">
    quick and easy.
  </p>
  <p style="margin:32px 0 0;font-size:12px;color:rgba(26,44,58,0.6);line-height:1.6">
    Results appear in the room when everyone weighs in — or when the poll closes, whichever comes first.
  </p>
</div>
</body>
</html>`;
}

function pollInviteText(asker: string, room: string, question: string, closes: string, url: string): string {
  return `@${asker} has a question.

@${asker} opened a poll in "${room}":

  "${question}"

Drop in and weigh in. Open until ${closes}.

Answer the poll: ${url}

quick and easy.

Results appear in the room when everyone weighs in — or when the poll closes, whichever comes first.`;
}

// ── poll_close ───────────────────────────────────────────────────────────

async function handlePollClose(
  poll: { id: string; asker_id: string; group_id: string; closed_at: string | null },
  showName: string,
  roomName: string,
  user: { id: string },
  admin: AdminClient,
  jsonOk: (b: Record<string, unknown>) => Response,
  jsonError: (code: string, status: number, message?: string) => Response,
): Promise<Response> {
  // Caller must be a current member of the poll's room.
  const { data: callerMember } = await admin
    .from("friend_group_members")
    .select("user_id")
    .eq("group_id", poll.group_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!callerMember) return jsonError("not_member", 403);

  // Poll must be closed.
  if (!poll.closed_at) return jsonError("not_closed", 400);

  // Counts.
  const { count: responseCount } = await admin
    .from("poll_responses")
    .select("id", { count: "exact", head: true })
    .eq("poll_id", poll.id);
  const { count: eligibleCount } = await admin
    .from("friend_group_members")
    .select("user_id", { count: "exact", head: true })
    .eq("group_id", poll.group_id);

  // Asker email.
  const { data: askerUser } = await admin.auth.admin.getUserById(poll.asker_id);
  const askerEmail = askerUser?.user?.email;
  if (!askerEmail) return jsonOk({ channel: "email", warning: "no_recipient_email" });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return jsonOk({ channel: "email", warning: "email_not_configured" });

  const { data: showLookup } = await admin
    .from("polls")
    .select("group_id")
    .eq("id", poll.id)
    .single();
  // grp.show_id was looked up in handlePoll already; re-pull for the URL.
  const { data: grp } = await admin
    .from("friend_groups")
    .select("show_id")
    .eq("id", poll.group_id)
    .single();
  const baseUrl = (Deno.env.get("APP_URL") ?? "https://beta.sidebar.watch").replace(/\/$/, "");
  const roomUrl = `${baseUrl}/show/${encodeURIComponent(grp?.show_id ?? "")}`;
  void showLookup;

  const subject = `Your ${showName} poll closed`;
  const respN = responseCount ?? 0;
  const eligN = eligibleCount ?? 0;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:56px 32px">
  <h1 style="margin:0 0 24px;font-size:22px;color:#1a2c3a;font-weight:800;line-height:1.35">
    Your poll's done.
  </h1>
  <p style="margin:0 0 28px;font-size:15px;color:#1a2c3a;line-height:1.55">
    Your poll in &ldquo;${escapeHtml(roomName)}&rdquo; closed. ${respN} of ${eligN} friends weighed in. Head over to see what they said.
  </p>
  <a href="${roomUrl}" style="display:inline-block;background:#dea838;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:15px;font-weight:700">
    See the results →
  </a>
  <p style="margin:28px 0 0;font-size:14px;color:#1a2c3a;font-style:italic">
    small moment, hosted by you.
  </p>
  <p style="margin:32px 0 0;font-size:12px;color:rgba(26,44,58,0.6);line-height:1.6">
    The results sticky stays in the room for 48 hours.
  </p>
</div>
</body>
</html>`;

  const text = `Your poll's done.

Your poll in "${roomName}" closed. ${respN} of ${eligN} friends weighed in. Head over to see what they said.

See the results: ${roomUrl}

small moment, hosted by you.

The results sticky stays in the room for 48 hours.`;

  const sent = await sendResendEmail(resendKey, askerEmail, subject, html, text);
  if (!sent) return jsonOk({ channel: "email", warning: "email_send_failed" });
  return jsonOk({ channel: "email" });
}

// ── poll_vote_notification ───────────────────────────────────────────────
// Asker gets one short email per vote, batched 5 minutes per poll.

async function handlePollVoteNotification(
  poll: { id: string; asker_id: string; group_id: string; last_vote_notification_at: string | null },
  grp: { show_id: string },
  showName: string,
  _roomName: string,
  user: { id: string },
  admin: AdminClient,
  jsonOk: (b: Record<string, unknown>) => Response,
  jsonError: (code: string, status: number, message?: string) => Response,
): Promise<Response> {
  // Caller must have actually voted on this poll. Without this check,
  // anyone could spam vote-notification emails to the asker.
  const { data: voterResponse } = await admin
    .from("poll_responses")
    .select("id, option_id, write_in_text, responded_at")
    .eq("poll_id", poll.id)
    .eq("responder_id", user.id)
    .maybeSingle();
  if (!voterResponse) return jsonError("vote_not_recorded", 400);

  // 5-min batching window per poll.
  if (poll.last_vote_notification_at) {
    const lastMs = new Date(poll.last_vote_notification_at).getTime();
    const elapsedMs = Date.now() - lastMs;
    if (elapsedMs < POLL_VOTE_NOTIFICATION_BATCH_MIN * 60 * 1000) {
      return jsonOk({ channel: "batched" });
    }
  }

  // Voter username.
  const { data: voterProfile } = await admin
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();
  const voterHandle = voterProfile?.username || "a friend";

  // Voter's choice — option text or write-in.
  let choiceLabel = "(write-in)";
  if (voterResponse.option_id) {
    const { data: opt } = await admin
      .from("poll_options")
      .select("option_text")
      .eq("id", voterResponse.option_id)
      .single();
    if (opt?.option_text) choiceLabel = opt.option_text;
  } else if (voterResponse.write_in_text) {
    choiceLabel = voterResponse.write_in_text;
  }

  // Asker email.
  const { data: askerUser } = await admin.auth.admin.getUserById(poll.asker_id);
  const askerEmail = askerUser?.user?.email;
  if (!askerEmail) return jsonOk({ channel: "email", warning: "no_recipient_email" });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return jsonOk({ channel: "email", warning: "email_not_configured" });

  const baseUrl = (Deno.env.get("APP_URL") ?? "https://beta.sidebar.watch").replace(/\/$/, "");
  const roomUrl = `${baseUrl}/show/${encodeURIComponent(grp.show_id)}`;
  const subject = `@${voterHandle} voted on your ${showName} poll`;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:56px 32px">
  <h1 style="margin:0 0 16px;font-size:20px;color:#1a2c3a;font-weight:700;line-height:1.35">
    @${escapeHtml(voterHandle)} voted on your ${escapeHtml(showName)} poll.
  </h1>
  <p style="margin:0 0 24px;padding:14px 18px;background:#f6f4ee;border-left:3px solid #1a2c3a;font-size:15px;color:#1a2c3a;line-height:1.5">
    ${escapeHtml(choiceLabel)}
  </p>
  <a href="${roomUrl}" style="display:inline-block;background:#dea838;color:#fff;text-decoration:none;padding:10px 24px;border-radius:999px;font-size:14px;font-weight:700">
    Open the room →
  </a>
  <p style="margin:24px 0 0;font-size:14px;color:#1a2c3a;font-style:italic">
    one in.
  </p>
</div>
</body>
</html>`;

  const text = `@${voterHandle} voted on your ${showName} poll.

  ${choiceLabel}

Open the room: ${roomUrl}

one in.`;

  const sent = await sendResendEmail(resendKey, askerEmail, subject, html, text);

  // Stamp last_vote_notification_at regardless of email success — the
  // batching window should advance even if Resend hiccups, otherwise a
  // single Resend failure would unbatch all subsequent votes in the
  // window.
  await admin
    .from("polls")
    .update({ last_vote_notification_at: new Date().toISOString() })
    .eq("id", poll.id);

  if (!sent) return jsonOk({ channel: "email", warning: "email_send_failed" });
  return jsonOk({ channel: "email" });
}

// ── SIKW asks ────────────────────────────────────────────────────────────
// Two sub-templates. Both take { template_type, ask_id }.
//   sikw_ask_invite — asker → all non-asker members. Multicast.
//   sikw_reply      — replier → asker. Single send. No batching (per
//                     spec: each reply gets its own email).

async function handleSikw(
  body: Record<string, unknown>,
  user: { id: string; email?: string },
  admin: AdminClient,
  jsonOk: (b: Record<string, unknown>) => Response,
  jsonError: (code: string, status: number, message?: string) => Response,
): Promise<Response> {
  const { template_type, ask_id } = body as Record<string, string>;
  if (!ask_id) return jsonError("missing_fields", 400);

  const { data: ask, error: askErr } = await admin
    .from("sikw_asks")
    .select("id, asker_id, group_id, message, asker_progress_season, asker_progress_episode, created_at, closed_at")
    .eq("id", ask_id)
    .single();
  if (askErr || !ask) return jsonError("ask_not_found", 404);

  const { data: grp } = await admin
    .from("friend_groups")
    .select("name, show_id, deleted_at")
    .eq("id", ask.group_id)
    .single();
  if (!grp || grp.deleted_at) return jsonError("group_not_found", 404);

  const { data: showRow } = await admin
    .from("shows")
    .select("name")
    .eq("id", grp.show_id)
    .single();
  const showName = showRow?.name?.trim() || "a show";
  const roomName = grp.name?.trim() || "your room";

  if (template_type === "sikw_ask_invite") {
    return await handleSikwAskInvite(ask, grp, showName, roomName, user, admin, jsonOk, jsonError);
  }
  if (template_type === "sikw_reply") {
    return await handleSikwReply(ask, grp, showName, roomName, user, admin, jsonOk, jsonError);
  }
  return jsonError("invalid_template_type", 400);
}

// ── sikw_ask_invite ──────────────────────────────────────────────────────

async function handleSikwAskInvite(
  ask: { id: string; asker_id: string; group_id: string; asker_progress_season: number; asker_progress_episode: number },
  grp: { show_id: string },
  showName: string,
  roomName: string,
  user: { id: string },
  admin: AdminClient,
  jsonOk: (b: Record<string, unknown>) => Response,
  jsonError: (code: string, status: number, message?: string) => Response,
): Promise<Response> {
  if (ask.asker_id !== user.id) return jsonError("not_asker", 403);

  const { data: askerProfile } = await admin
    .from("profiles")
    .select("username")
    .eq("id", ask.asker_id)
    .single();
  const askerHandle = askerProfile?.username || "a friend";

  const { data: members } = await admin
    .from("friend_group_members")
    .select("user_id")
    .eq("group_id", ask.group_id);
  const recipientIds = (members ?? [])
    .map((m: { user_id: string }) => m.user_id)
    .filter((id: string) => id !== ask.asker_id);

  if (recipientIds.length === 0) {
    return jsonOk({ sent_count: 0, channel: "email" });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return jsonOk({ sent_count: 0, channel: "email", warning: "email_not_configured" });
  }

  const baseUrl = (Deno.env.get("APP_URL") ?? "https://beta.sidebar.watch").replace(/\/$/, "");
  const roomUrl = `${baseUrl}/show/${encodeURIComponent(grp.show_id)}`;
  const subject = `@${askerHandle} is wondering whether to stick with ${showName}`;
  const progressLabel = formatSE(ask.asker_progress_season, ask.asker_progress_episode);

  let sentCount = 0;
  let failedCount = 0;
  for (const rid of recipientIds) {
    const { data: rcptUser } = await admin.auth.admin.getUserById(rid);
    const email = rcptUser?.user?.email;
    if (!email) {
      failedCount++;
      continue;
    }
    const html = sikwAskInviteHtml(askerHandle, showName, roomName, progressLabel, roomUrl);
    const text = sikwAskInviteText(askerHandle, showName, roomName, progressLabel, roomUrl);
    const sent = await sendResendEmail(resendKey, email, subject, html, text);
    if (sent) sentCount++; else failedCount++;
  }

  return jsonOk({ sent_count: sentCount, failed_count: failedCount, channel: "email" });
}

function sikwAskInviteHtml(asker: string, show: string, room: string, progress: string, url: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:56px 32px">
  <h1 style="margin:0 0 24px;font-size:22px;color:#1a2c3a;font-weight:800;line-height:1.35">
    @${escapeHtml(asker)} needs your read.
  </h1>
  <p style="margin:0 0 24px;font-size:15px;color:#1a2c3a;line-height:1.55">
    @${escapeHtml(asker)} is at <strong>${escapeHtml(progress)}</strong> of <strong><em>${escapeHtml(show)}</em></strong> and asking the room: should they keep watching? Head to &ldquo;${escapeHtml(room)}&rdquo; to weigh in &mdash; without spoilers, of course.
  </p>
  <a href="${url}" style="display:inline-block;background:#dea838;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:15px;font-weight:700">
    Help them out →
  </a>
  <p style="margin:28px 0 0;font-size:14px;color:#1a2c3a;font-style:italic">
    be honest.
  </p>
  <p style="margin:32px 0 0;font-size:12px;color:rgba(26,44,58,0.6);line-height:1.6">
    Replies are spoiler-light by structure. You'll be able to suggest sticking with it, name an episode to push toward, or quietly say it's fair to drop.
  </p>
</div>
</body>
</html>`;
}

function sikwAskInviteText(asker: string, show: string, room: string, progress: string, url: string): string {
  return `@${asker} needs your read.

@${asker} is at ${progress} of ${show} and asking the room: should they keep watching? Head to "${room}" to weigh in — without spoilers, of course.

Help them out: ${url}

be honest.

Replies are spoiler-light by structure. You'll be able to suggest sticking with it, name an episode to push toward, or quietly say it's fair to drop.`;
}

// ── sikw_reply ───────────────────────────────────────────────────────────
// Email body deliberately does NOT include the reply content. Per
// spec: "Replies appear in the room, not in this email — so you can
// read them in context."

async function handleSikwReply(
  ask: { id: string; asker_id: string; group_id: string },
  grp: { show_id: string },
  showName: string,
  roomName: string,
  user: { id: string },
  admin: AdminClient,
  jsonOk: (b: Record<string, unknown>) => Response,
  jsonError: (code: string, status: number, message?: string) => Response,
): Promise<Response> {
  // Caller must have an actual reply on this ask.
  const { data: replyRow } = await admin
    .from("sikw_replies")
    .select("id")
    .eq("ask_id", ask.id)
    .eq("replier_id", user.id)
    .maybeSingle();
  if (!replyRow) return jsonError("reply_not_recorded", 400);

  const { data: replierProfile } = await admin
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();
  const replierHandle = replierProfile?.username || "a friend";

  const { data: askerUser } = await admin.auth.admin.getUserById(ask.asker_id);
  const askerEmail = askerUser?.user?.email;
  if (!askerEmail) return jsonOk({ channel: "email", warning: "no_recipient_email" });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return jsonOk({ channel: "email", warning: "email_not_configured" });

  const baseUrl = (Deno.env.get("APP_URL") ?? "https://beta.sidebar.watch").replace(/\/$/, "");
  const roomUrl = `${baseUrl}/show/${encodeURIComponent(grp.show_id)}`;
  const subject = `@${replierHandle} weighed in on ${showName}`;

  const html = sikwReplyHtml(replierHandle, showName, roomName, roomUrl);
  const text = sikwReplyText(replierHandle, showName, roomName, roomUrl);

  const sent = await sendResendEmail(resendKey, askerEmail, subject, html, text);
  if (!sent) return jsonOk({ channel: "email", warning: "email_send_failed" });
  return jsonOk({ channel: "email" });
}

function sikwReplyHtml(replier: string, show: string, room: string, url: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:56px 32px">
  <h1 style="margin:0 0 24px;font-size:22px;color:#1a2c3a;font-weight:800;line-height:1.35">
    @${escapeHtml(replier)} sent a reply.
  </h1>
  <p style="margin:0 0 28px;font-size:15px;color:#1a2c3a;line-height:1.55">
    You asked the room whether to stick with <strong><em>${escapeHtml(show)}</em></strong>. @${escapeHtml(replier)} got back to you &mdash; head to &ldquo;${escapeHtml(room)}&rdquo; to read it.
  </p>
  <a href="${url}" style="display:inline-block;background:#dea838;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:15px;font-weight:700">
    Read the reply →
  </a>
  <p style="margin:28px 0 0;font-size:14px;color:#1a2c3a;font-style:italic">
    one friend, one read.
  </p>
  <p style="margin:32px 0 0;font-size:12px;color:rgba(26,44,58,0.6);line-height:1.6">
    Replies appear in the room, not in this email &mdash; so you can read them in context.
  </p>
</div>
</body>
</html>`;
}

function sikwReplyText(replier: string, show: string, room: string, url: string): string {
  return `@${replier} sent a reply.

You asked the room whether to stick with ${show}. @${replier} got back to you — head to "${room}" to read it.

Read the reply: ${url}

one friend, one read.

Replies appear in the room, not in this email — so you can read them in context.`;
}

function formatSE(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")} E${String(episode).padStart(2, "0")}`;
}

// ── shared helpers ───────────────────────────────────────────────────────

async function sendResendEmail(
  resendKey: string,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html, text }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("Resend error:", detail);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Resend fetch error:", err);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
