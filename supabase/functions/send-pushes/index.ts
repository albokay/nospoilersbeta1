// ============================================================
// Supabase Edge Function: send-pushes
//
// Push notifications (Alborz 2026-11-05).
//
// BATCHES (CP2): pg_cron calls this every hour (run_push_batches, shared
// secret like send-digests). A person is due at 8am, 11am, 2pm, 5pm and 8pm
// in their own time zone (their newest device's), so nothing ever arrives
// 10pm–8am and the 8am push covers the night. When due, everything friends
// did since their last batch (push_state.covered_until; at most 24h back)
// becomes ONE push (wording in activity.ts); nothing new, no push. Either way
// the window closes, so nothing is ever pushed twice. What they've already
// opened in the app, and anything sealed for them, never pushes.
//
// TEST (CP1, kept): a signed-in person's "Send a test" in the account card.
// It sends what their NEXT push would say (without closing the window), or
// "Notifications are on for this device." when nothing's waiting.
//
// Invocation:
//   POST  x-digest-secret: <DIGEST_CRON_SECRET>
//         Body: { batch: true, dry_run?: bool, force?: bool, only_user_id?: uuid }
//         dry_run → compute + report, send nothing, close nothing.
//         force   → ignore the hour (every person with a device is due).
//         window_hours (dry runs only, 1–24) → look back this far instead of
//         the last batch, to see what a busy stretch would have said.
//   POST  Authorization: Bearer <user-jwt>   Body: { test: true }
// A device the push service reports gone (404/410) is deleted on the spot.
//
// Environment variables required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   VAPID_PRIVATE_KEY   (manual; from supabase/functions/.env, never committed)
//   DIGEST_CRON_SECRET  (manual; already set for send-digests)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush, type VapidKeys } from "../_shared/webpush.ts";
import { gatherActs, composePush, type Act } from "./activity.ts";

// The public half of Sidebar's key pair; the app subscribes with the same one
// (src/lib/push.ts). Public by design.
const VAPID_PUBLIC_KEY = "BEy3WeEFKAm1M-dRFil1GlxWYC_2-KyMF8srQj15R8DgHvluVlUZ1--5GSpvxu5DlrtAcrlBJWoZGgsnJQZ3gZM";
const VAPID_SUBJECT = "mailto:letters@sidebar.watch";

const BATCH_HOURS = [8, 11, 14, 17, 20];
const DEFAULT_TZ = "America/Los_Angeles";
const DEFAULT_WINDOW_H = 3;
const MAX_WINDOW_H = 24;

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

function localHour(tz: string | null | undefined, now: Date): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz || DEFAULT_TZ, hour: "numeric", hourCycle: "h23" }).format(now)) % 24;
  } catch {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TZ, hour: "numeric", hourCycle: "h23" }).format(now)) % 24;
  }
}

type Device = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; time_zone: string | null; updated_at: string };

/** Names the recipient's way: their own saved name for the friend, else the
 *  friend's first name. */
async function namesFor(admin: any, recipientIds: string[], acts: Map<string, Act[]>): Promise<(rid: string) => (id: string) => string> {
  const friendIds = [...new Set([...acts.values()].flat().map((a) => a.friendId))];
  const first = new Map<string, string>();
  const contacts = new Map<string, Map<string, string>>();
  if (friendIds.length) {
    const { data } = await admin.from("profiles").select("id, display_name").in("id", friendIds);
    for (const p of (data ?? []) as any[]) if (p.display_name) first.set(p.id, String(p.display_name));
  }
  if (recipientIds.length) {
    const { data } = await admin.from("contact_names").select("owner_id, contact_id, name").in("owner_id", recipientIds);
    for (const c of (data ?? []) as any[]) {
      if (!c.name) continue;
      if (!contacts.has(c.owner_id)) contacts.set(c.owner_id, new Map());
      contacts.get(c.owner_id)!.set(c.contact_id, String(c.name));
    }
  }
  return (rid) => (id) => contacts.get(rid)?.get(id) ?? first.get(id) ?? "A friend";
}

async function deliver(admin: any, devices: Device[], payload: Record<string, unknown>, vapid: VapidKeys, opts: { ttlSec: number; urgency: "normal" | "high"; topic?: string }) {
  return Promise.all(devices.map(async (d) => {
    const r = await sendPush(d, payload, vapid, opts);
    if (r.gone) await admin.from("push_devices").delete().eq("id", d.id);
    return { device: new URL(d.endpoint).host, status: r.status, gone: r.gone, ...(r.detail ? { detail: r.detail } : {}) };
  }));
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
  const body = await req.json().catch(() => ({})) as Record<string, any>;
  const now = new Date();

  // ── The batches (cron) ───────────────────────────────────────────────────
  const secret = Deno.env.get("DIGEST_CRON_SECRET");
  const provided = req.headers.get("x-digest-secret");
  if (provided) {
    if (!secret || provided !== secret) return json({ ok: false, error: "unauthorized" }, 401);
    if (!body.batch) return json({ ok: false, error: "unknown_request" }, 400);
    const dryRun = !!body.dry_run;
    const force = !!body.force;
    const onlyUserId: string | null = body.only_user_id ?? null;
    const lookbackH = dryRun && Number(body.window_hours) > 0 ? Math.min(MAX_WINDOW_H, Number(body.window_hours)) : null;

    let q = admin.from("push_devices").select("id, user_id, endpoint, p256dh, auth, time_zone, updated_at");
    if (onlyUserId) q = q.eq("user_id", onlyUserId);
    const { data: devRows, error: devErr } = await q;
    if (devErr) return json({ ok: false, error: "devices_read", message: devErr.message }, 500);
    const devicesByUser = new Map<string, Device[]>();
    for (const d of (devRows ?? []) as Device[]) {
      if (!devicesByUser.has(d.user_id)) devicesByUser.set(d.user_id, []);
      devicesByUser.get(d.user_id)!.push(d);
    }
    const userIds = [...devicesByUser.keys()];
    if (!userIds.length) return json({ ok: true, due: 0, sent: 0, reason: "no devices" });

    // A deleted account's devices go (on a real run); it never pushes.
    const { data: profs } = await admin.from("profiles").select("id, username").in("id", userIds);
    const deleted = new Set(((profs ?? []) as any[]).filter((p) => String(p.username ?? "").startsWith("deleted_")).map((p) => p.id as string));
    if (deleted.size && !dryRun) await admin.from("push_devices").delete().in("user_id", [...deleted]);

    const { data: stateRows } = await admin.from("push_state").select("user_id, covered_until").in("user_id", userIds);
    const coveredUntil = new Map<string, string>(((stateRows ?? []) as any[]).filter((s) => s.covered_until).map((s) => [s.user_id, s.covered_until]));

    const due = userIds.filter((uid) => {
      if (deleted.has(uid)) return false;
      if (force) return true;
      const newest = [...devicesByUser.get(uid)!].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
      if (!BATCH_HOURS.includes(localHour(newest?.time_zone, now))) return false;
      // Already batched this hour (a retried cron call): skip.
      const cu = coveredUntil.get(uid);
      return !cu || now.getTime() - new Date(cu).getTime() > 90 * 60 * 1000;
    });
    if (!due.length) return json({ ok: true, due: 0, sent: 0, reason: "nobody due this hour" });

    const since = new Date(now.getTime() - MAX_WINDOW_H * 3600 * 1000).toISOString();
    const acts = await gatherActs(admin, since, new Set(due));
    const nameFor = await namesFor(admin, due, acts);

    let sent = 0;
    const report: any[] = [];
    for (const uid of due) {
      const start = lookbackH != null ? now.getTime() - lookbackH * 3600 * 1000 : Math.max(
        coveredUntil.has(uid) ? new Date(coveredUntil.get(uid)!).getTime() : now.getTime() - DEFAULT_WINDOW_H * 3600 * 1000,
        now.getTime() - MAX_WINDOW_H * 3600 * 1000,
      );
      const mine = (acts.get(uid) ?? []).filter((a) => new Date(a.at).getTime() > start);
      const push = composePush(mine, nameFor(uid));
      const entry: any = { userId: uid, things: mine.length, from: new Date(start).toISOString() };
      if (dryRun) entry.list = mine.map((a) => `${a.kind} ${a.at}`);
      if (push) entry.body = push.body;
      if (push && !dryRun) {
        const results = await deliver(admin, devicesByUser.get(uid)!, { title: "Sidebar", body: push.body, url: push.url }, vapid, { ttlSec: 12 * 3600, urgency: "normal" });
        entry.results = results;
        if (results.some((r) => r.status >= 200 && r.status < 300)) sent++;
      }
      if (!dryRun) {
        await admin.from("push_state").upsert({ user_id: uid, covered_until: now.toISOString(), ...(push ? { last_sent_at: now.toISOString() } : {}), updated_at: now.toISOString() }, { onConflict: "user_id" });
      }
      report.push(entry);
    }
    return json({ ok: true, dryRun, due: due.length, sent, report });
  }

  // ── The test (a signed-in person, their own devices) ────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "missing_auth" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ ok: false, error: "unauthorized" }, 401);
  if (!body.test) return json({ ok: false, error: "unknown_request" }, 400);

  const { data: devices, error: devErr } = await admin
    .from("push_devices").select("id, user_id, endpoint, p256dh, auth, time_zone, updated_at").eq("user_id", user.id);
  if (devErr) return json({ ok: false, error: "devices_read", message: devErr.message }, 500);
  if (!devices?.length) return json({ ok: true, sent: 0, gone: 0, results: [] });

  // What the next push would say, if anything's waiting.
  let payload: Record<string, unknown> = { title: "Sidebar", body: "Notifications are on for this device.", url: "/" };
  try {
    const { data: st } = await admin.from("push_state").select("covered_until").eq("user_id", user.id).maybeSingle();
    const start = Math.max(
      st?.covered_until ? new Date(st.covered_until).getTime() : now.getTime() - DEFAULT_WINDOW_H * 3600 * 1000,
      now.getTime() - MAX_WINDOW_H * 3600 * 1000,
    );
    const acts = await gatherActs(admin, new Date(now.getTime() - MAX_WINDOW_H * 3600 * 1000).toISOString(), new Set([user.id]));
    const mine = (acts.get(user.id) ?? []).filter((a) => new Date(a.at).getTime() > start);
    const push = composePush(mine, (await namesFor(admin, [user.id], acts))(user.id));
    if (push) payload = { title: "Sidebar", body: push.body, url: push.url };
  } catch (e) {
    console.warn("[test] preview skipped:", e);
  }
  const results = await deliver(admin, devices as Device[], payload, vapid, { ttlSec: 600, urgency: "high", topic: "test" });
  return json({
    ok: true,
    body: payload.body,
    sent: results.filter((r) => r.status >= 200 && r.status < 300).length,
    gone: results.filter((r) => r.gone).length,
    results,
  });
});
