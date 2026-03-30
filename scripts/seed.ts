/**
 * One-time seeding script — loads all mock data into Supabase.
 * Run from the project root: npx tsx scripts/seed.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { seedShows, seedThreads, repliesByThread } from "../src/lib/mockData";
import type { Reply } from "../src/types";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Sort replies so parents always come before children (avoids FK constraint errors)
function topoSort(replies: Reply[]): Reply[] {
  const byId: Record<string, Reply> = {};
  for (const r of replies) byId[r.id] = r;
  const result: Reply[] = [];
  const visited = new Set<string>();
  function visit(r: Reply) {
    if (visited.has(r.id)) return;
    if (r.replyToId && byId[r.replyToId]) visit(byId[r.replyToId]);
    visited.add(r.id);
    result.push(r);
  }
  for (const r of replies) visit(r);
  return result;
}

async function seed() {
  // ── 1. Shows ─────────────────────────────────────────────
  console.log("Seeding shows...");
  const { error: showsErr } = await supabase
    .from("shows")
    .upsert(seedShows.map(s => ({ id: s.id, name: s.name, seasons: s.seasons })), { onConflict: "id" });
  if (showsErr) throw showsErr;
  console.log(`  ✓ ${seedShows.length} shows`);

  // ── 2. Seed author profiles ───────────────────────────────
  console.log("Seeding author profiles...");
  const authorNames = new Set<string>();
  for (const t of seedThreads) authorNames.add(t.author);
  for (const replies of Object.values(repliesByThread))
    for (const r of replies) authorNames.add(r.author);

  // Fetch existing seed profiles to avoid duplicate inserts
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("is_seed", true);
  const existingMap: Record<string, string> = {};
  for (const p of existing || []) existingMap[p.username] = p.id;

  const newProfiles = Array.from(authorNames)
    .filter(name => !existingMap[name])
    .map(username => ({ id: crypto.randomUUID(), username, is_seed: true }));

  if (newProfiles.length) {
    const { error } = await supabase.from("profiles").insert(newProfiles);
    if (error) throw error;
    for (const p of newProfiles) existingMap[p.username] = p.id;
  }
  const authorMap = existingMap;
  console.log(`  ✓ ${Object.keys(authorMap).length} authors`);

  // ── 3. Threads ────────────────────────────────────────────
  console.log("Seeding threads...");
  const threadRows = seedThreads.map(t => ({
    id: t.id,
    show_id: t.showId,
    season: t.season,
    episode: t.episode,
    author_id: authorMap[t.author] ?? null,
    author_name: t.author,
    title: t.titleBase,
    preview: t.preview,
    body: t.body,
    is_private: t.isPrivate ?? false,
    likes_count: t.likes,
    created_at: new Date(t.updatedAt).toISOString(),
    updated_at: new Date(t.updatedAt).toISOString(),
  }));
  const { error: threadsErr } = await supabase
    .from("threads")
    .upsert(threadRows, { onConflict: "id" });
  if (threadsErr) throw threadsErr;
  console.log(`  ✓ ${threadRows.length} threads`);

  // ── 4. Replies (topologically sorted, batched) ────────────
  console.log("Seeding replies...");
  const allReplies = topoSort(Object.values(repliesByThread).flat());
  const replyRows = allReplies.map(r => ({
    id: r.id,
    thread_id: r.threadId,
    show_id: r.showId,
    season: r.season,
    episode: r.episode,
    author_id: authorMap[r.author] ?? null,
    author_name: r.author,
    body: r.body,
    reply_to_id: r.replyToId ?? null,
    likes_count: r.likes,
    created_at: new Date(r.updatedAt).toISOString(),
    updated_at: new Date(r.updatedAt).toISOString(),
  }));

  const CHUNK = 200;
  for (let i = 0; i < replyRows.length; i += CHUNK) {
    const chunk = replyRows.slice(i, i + CHUNK);
    const { error } = await supabase.from("replies").upsert(chunk, { onConflict: "id" });
    if (error) throw error;
    process.stdout.write(`\r  replies: ${Math.min(i + CHUNK, replyRows.length)}/${replyRows.length}`);
  }
  console.log(`\n  ✓ ${replyRows.length} replies`);

  console.log("\n✅ Seeding complete!");
}

seed().catch(err => { console.error("\n❌ Seed failed:", err.message); process.exit(1); });
