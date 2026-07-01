import * as Sentry from "@sentry/react";

// Remote error tracking. DORMANT until VITE_SENTRY_DSN is set (Vercel env +
// local .env.local) — with no DSN, init is skipped and every capture is a
// no-op, so shipping this changes nothing until you flip it on.
//
// The DSN is a PUBLIC value by design (like the Supabase anon key) — it only
// permits sending events to your project, so it's safe in the client bundle.
//
// Scope: errors only. No performance tracing and no session replay, to keep
// the bundle and your Sentry quota lean. Sentry's default global handlers still
// capture uncaught errors AND unhandled promise rejections automatically — that
// closes the gap the render-only ErrorBoundary can't (event handlers + async
// Supabase calls). Render crashes are additionally forwarded from
// ErrorBoundary.componentDidCatch via captureError() below (for the component
// stack).
const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function initSentry(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
  });
}

export function captureError(error: unknown, componentStack?: string | null): void {
  if (!DSN) return;
  Sentry.captureException(
    error,
    componentStack ? { contexts: { react: { componentStack } } } : undefined,
  );
}
