// ============================================================
// Supabase Edge Function: send-pushes
//
// Push notifications (Alborz 2026-11-05). CP1 is the test push only: a
// signed-in person asks for one notification on every device they've turned
// on ("Send a test" in the account card, admins only in the app). It proves
// the whole road: the device saved, the keys, the encryption, the phone.
// CP2 adds the timed batches here (cron, shared secret like send-digests).
//
// Invocation:
//   POST  Authorization: Bearer <user-jwt>   Body: { "test": true }
//   → { ok, sent, gone, results: [{ device, status, detail? }] }
// A device the push service reports gone (404/410) is deleted on the spot.
//
// Environment variables required:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   VAPID_PRIVATE_KEY         (manual; from supabase/functions/.env, never committed)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush, type VapidKeys } from "../_shared/webpush.ts";

// The public half of Sidebar's key pair; the app subscribes with the same one
// (src/lib/push.ts). Public by design.
const VAPID_PUBLIC_KEY = "BEy3WeEFKAm1M-dRFil1GlxWYC_2-KyMF8srQj15R8DgHvluVlUZ1--5GSpvxu5DlrtAcrlBJWoZGgsnJQZ3gZM";
const VAPID_SUBJECT = "mailto:letters@sidebar.watch";

const ALLOWED_ORIGINS = new Set([
  "https://beta.sidebar.watch",
  "http://localhost:5173",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://beta.sidebar.watch";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!privateKey) return json({ ok: false, error: "vapid_missing" }, 500);
  const vapid: VapidKeys = { publicKey: VAPID_PUBLIC_KEY, privateKey, subject: VAPID_SUBJECT };

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "missing_auth" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body?.test) return json({ ok: false, error: "unknown_request" }, 400);

  const { data: devices, error: devErr } = await admin
    .from("push_devices").select("id, endpoint, p256dh, auth").eq("user_id", user.id);
  if (devErr) return json({ ok: false, error: "devices_read", message: devErr.message }, 500);
  if (!devices?.length) return json({ ok: true, sent: 0, gone: 0, results: [] });

  const payload = { title: "Sidebar", body: "Notifications are on for this device.", url: "/" };
  const results = await Promise.all((devices as any[]).map(async (d) => {
    const r = await sendPush(d, payload, vapid, { ttlSec: 600, urgency: "high", topic: "test" });
    if (r.gone) await admin.from("push_devices").delete().eq("id", d.id);
    return { device: new URL(d.endpoint).host, status: r.status, gone: r.gone, ...(r.detail ? { detail: r.detail } : {}) };
  }));
  return json({
    ok: true,
    sent: results.filter((r) => r.status >= 200 && r.status < 300).length,
    gone: results.filter((r) => r.gone).length,
    results,
  });
});
