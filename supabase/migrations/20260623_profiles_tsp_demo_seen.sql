-- ============================================================
-- TSP onboarding demo — once-only durable gate (spec §3)
-- ============================================================
-- ADDITIVE, idempotent. A per-user durable flag so the TSP onboarding demo
-- plays exactly once (in the same spirit as profiles.onboarded_at). The demo
-- content itself is fully in-memory (no demo-content tables / no provisioning,
-- spec §8); this flag is the one permitted persistence — it marks "seen".
--
-- GATED: apply at the restructure cutover, when the TSP demo becomes the
-- post-signup step. Until then the demo is inert (TSP_DEMO_ENABLED=false in
-- DashboardPage; force-show via ?tspdemo=1 for testing reads/writes nothing).
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tsp_demo_seen_at TIMESTAMPTZ;
