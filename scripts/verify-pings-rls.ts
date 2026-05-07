/**
 * RLS verification harness for the pings table + dismiss_ping RPC.
 *
 * Exercises every read / write pattern the round-1 frontend will use,
 * via two real authenticated user sessions (their JWTs) plus a
 * service-role client for seeding and cleanup. Verifies the RLS
 * policies + dismiss_ping behave as designed BEFORE any frontend
 * code lands.
 *
 * Run from the project root:
 *   npx tsx scripts/verify-pings-rls.ts
 *
 * Required .env.local entries:
 *   VITE_SUPABASE_URL                 (already in .env.local)
 *   SUPABASE_SERVICE_ROLE_KEY         (already in .env.local)
 *   VITE_SUPABASE_ANON_KEY            (already in .env.local)
 *
 *   USER_A_JWT      access_token from your admin session
 *   USER_A_ID       admin user_id (uuid)
 *   USER_B_JWT      access_token from your test-account session
 *   USER_B_ID       test-account user_id (uuid)
 *   TEST_GROUP_ID   a friend_group both A and B are members of (uuid)
 *   TEST_SHOW_ID    show_id for that group (text)
 *
 * To capture a JWT:
 *   1. Sign in to beta.sidebar.watch (or the branch deploy) as the user
 *   2. DevTools → Application → Local Storage → look for the
 *      `sb-<projectref>-auth-token` key
 *   3. Copy the `access_token` value out of the stored JSON
 *
 * The harness seeds a few pings rows for testing and removes them at the
 * end (always — runs in a finally block even on test failure). It does
 * not touch any other rows.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── env validation ──────────────────────────────────────────────────────

const REQUIRED = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "USER_A_JWT",
  "USER_A_ID",
  "USER_B_JWT",
  "USER_B_ID",
  "TEST_GROUP_ID",
  "TEST_SHOW_ID",
] as const;

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("Missing env vars:");
  missing.forEach((k) => console.error(`  - ${k}`));
  console.error("\nAdd them to .env.local. See the script header for guidance.");
  process.exit(1);
}

const URL = process.env.VITE_SUPABASE_URL!;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const USER_A_JWT = process.env.USER_A_JWT!;
const USER_A_ID = process.env.USER_A_ID!;
const USER_B_JWT = process.env.USER_B_JWT!;
const USER_B_ID = process.env.USER_B_ID!;
const TEST_GROUP_ID = process.env.TEST_GROUP_ID!;
const TEST_SHOW_ID = process.env.TEST_SHOW_ID!;

// ── client factories ────────────────────────────────────────────────────

const adminClient = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function userClient(jwt: string): SupabaseClient {
  return createClient(URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

const aClient = userClient(USER_A_JWT);
const bClient = userClient(USER_B_JWT);

// ── seeding + cleanup ───────────────────────────────────────────────────

const seededPingIds: string[] = [];

async function seedPing(
  senderId: string,
  recipientId: string,
  type: "nudge_ahead" | "nudge_same" | "nudge_behind",
): Promise<string> {
  const { data, error } = await adminClient
    .from("pings")
    .insert({
      sender_id: senderId,
      recipient_id: recipientId,
      show_id: TEST_SHOW_ID,
      group_id: TEST_GROUP_ID,
      ping_type: type,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedPing failed: ${error?.message ?? "no data"}`);
  seededPingIds.push(data.id);
  return data.id;
}

async function cleanup() {
  if (seededPingIds.length === 0) return;
  const { error } = await adminClient.from("pings").delete().in("id", seededPingIds);
  if (error) {
    console.error(`\nCleanup failed: ${error.message}`);
    console.error(`Manually remove these ping IDs:`);
    seededPingIds.forEach((id) => console.error(`  ${id}`));
  } else {
    console.log(`\nCleaned up ${seededPingIds.length} seeded ping(s).`);
  }
}

// ── tiny test runner ────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
    fail++;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ── tests ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Verifying pings RLS + dismiss_ping RPC\n");

  // Pre-flight: confirm both A and B are members of TEST_GROUP_ID.
  const { data: members } = await adminClient
    .from("friend_group_members")
    .select("user_id")
    .eq("group_id", TEST_GROUP_ID);
  const memberSet = new Set((members ?? []).map((m) => m.user_id));
  if (!memberSet.has(USER_A_ID) || !memberSet.has(USER_B_ID)) {
    console.error("Pre-flight failed: USER_A and USER_B must both be members of TEST_GROUP_ID");
    console.error(`  Members of ${TEST_GROUP_ID}: ${[...memberSet].join(", ")}`);
    process.exit(1);
  }

  // Seed pings:
  //   p1: A → B, active
  //   p2: B → A, active (will be dismissed by A in test)
  //   p3: B → A, pre-dismissed (for the already-dismissed test)
  //   p4: B → A, active (B will try to dismiss as non-recipient)
  let p1: string, p2: string, p3: string, p4: string;
  try {
    p1 = await seedPing(USER_A_ID, USER_B_ID, "nudge_ahead");
    p2 = await seedPing(USER_B_ID, USER_A_ID, "nudge_ahead");
    p3 = await seedPing(USER_B_ID, USER_A_ID, "nudge_same");
    p4 = await seedPing(USER_B_ID, USER_A_ID, "nudge_behind");

    // Pre-dismiss p3
    const { error: dErr } = await adminClient
      .from("pings")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("id", p3);
    if (dErr) throw new Error(`pre-dismiss of p3 failed: ${dErr.message}`);
  } catch (err) {
    console.error(`Seeding failed: ${err instanceof Error ? err.message : err}`);
    await cleanup();
    process.exit(1);
  }

  console.log("Seed complete. Running tests:\n");

  try {
    // ── SELECT policy ──────────────────────────────────────────────────

    await test("A can SELECT own ping where they are sender (p1)", async () => {
      const { data, error } = await aClient.from("pings").select("id").eq("id", p1);
      assert(!error, `error: ${error?.message}`);
      assert(data!.length === 1, `expected 1 row, got ${data!.length}`);
    });

    await test("A can SELECT own ping where they are recipient (p2)", async () => {
      const { data, error } = await aClient.from("pings").select("id").eq("id", p2);
      assert(!error, `error: ${error?.message}`);
      assert(data!.length === 1, `expected 1 row, got ${data!.length}`);
    });

    await test("B can SELECT own ping where they are sender (p2)", async () => {
      const { data, error } = await bClient.from("pings").select("id").eq("id", p2);
      assert(!error, `error: ${error?.message}`);
      assert(data!.length === 1, `expected 1 row, got ${data!.length}`);
    });

    // ── INSERT / UPDATE / DELETE blocked via REST ──────────────────────

    await test("A cannot INSERT pings via REST (RLS denies)", async () => {
      const { error } = await aClient.from("pings").insert({
        sender_id: USER_A_ID,
        recipient_id: USER_B_ID,
        show_id: TEST_SHOW_ID,
        group_id: TEST_GROUP_ID,
        ping_type: "nudge_ahead",
      });
      assert(error !== null, `expected error, got success`);
    });

    await test("A cannot UPDATE pings via REST (RLS denies)", async () => {
      // Read p2's current dismissed_at via service role for comparison
      const { data: before } = await adminClient
        .from("pings")
        .select("dismissed_at")
        .eq("id", p2)
        .single();
      const beforeDismissed = before?.dismissed_at;

      // Attempt the UPDATE as user A. With RLS denying, this either
      // errors or silently affects 0 rows; either way, the row's actual
      // state must be unchanged.
      await aClient
        .from("pings")
        .update({ dismissed_at: new Date().toISOString() })
        .eq("id", p2);

      const { data: after } = await adminClient
        .from("pings")
        .select("dismissed_at")
        .eq("id", p2)
        .single();
      assert(
        after?.dismissed_at === beforeDismissed,
        `row was modified: before=${beforeDismissed}, after=${after?.dismissed_at}`,
      );
    });

    await test("A cannot DELETE pings via REST (RLS denies)", async () => {
      // Attempt DELETE as user A. With RLS denying, the row should
      // still exist after.
      await aClient.from("pings").delete().eq("id", p1);

      const { data: stillThere } = await adminClient
        .from("pings")
        .select("id")
        .eq("id", p1);
      assert(stillThere?.length === 1, `row p1 was deleted`);
    });

    // ── dismiss_ping RPC ───────────────────────────────────────────────

    await test("A (recipient of p2) can dismiss p2 → returns TRUE", async () => {
      const { data, error } = await aClient.rpc("dismiss_ping", { p_ping_id: p2 });
      assert(!error, `error: ${error?.message}`);
      assert(data === true, `expected true, got ${data}`);

      // Verify the row actually got stamped
      const { data: row } = await adminClient
        .from("pings")
        .select("dismissed_at")
        .eq("id", p2)
        .single();
      assert(row?.dismissed_at !== null, `dismissed_at not stamped`);
    });

    await test("Second dismiss on p2 (already dismissed) → returns FALSE", async () => {
      const { data, error } = await aClient.rpc("dismiss_ping", { p_ping_id: p2 });
      assert(!error, `error: ${error?.message}`);
      assert(data === false, `expected false, got ${data}`);
    });

    await test("Dismiss on pre-dismissed p3 → returns FALSE", async () => {
      // A is recipient of p3, but it was pre-dismissed in setup
      const { data, error } = await aClient.rpc("dismiss_ping", { p_ping_id: p3 });
      assert(!error, `error: ${error?.message}`);
      assert(data === false, `expected false, got ${data}`);
    });

    await test("B (sender, not recipient) cannot dismiss p4 → returns FALSE", async () => {
      const { data, error } = await bClient.rpc("dismiss_ping", { p_ping_id: p4 });
      assert(!error, `error: ${error?.message}`);
      assert(data === false, `expected false, got ${data}`);

      // Verify p4 is still active
      const { data: row } = await adminClient
        .from("pings")
        .select("dismissed_at")
        .eq("id", p4)
        .single();
      assert(row?.dismissed_at === null, `p4 was dismissed: ${row?.dismissed_at}`);
    });

    await test("Dismiss with random UUID → returns FALSE, no error", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const { data, error } = await aClient.rpc("dismiss_ping", { p_ping_id: fakeId });
      assert(!error, `error: ${error?.message}`);
      assert(data === false, `expected false, got ${data}`);
    });
  } finally {
    await cleanup();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nharness crashed:", err);
  await cleanup();
  process.exit(1);
});
