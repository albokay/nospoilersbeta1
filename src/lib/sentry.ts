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

// Strip credentials from any URL before it leaves the browser (security pass
// 2026-08-14): invite tokens live in the path (/invite/:t, /group-invite/:t,
// /m/group-invite/:t), the email pre-fill rides ?email=, and the implicit
// auth flow lands access/refresh tokens in the #fragment on /reset-password
// and /confirm. Sentry's default breadcrumbs (fetch/navigation URLs) and
// request.url would otherwise ship these to the DSN. Dormant today (no DSN),
// but wired now so nothing sensitive ever flows if the DSN is switched on.
function scrubUrl(u: string): string {
  try {
    return u
      .replace(/(\/(?:m\/)?(?:group-)?invite\/)[^/?#]+/gi, "$1<redacted>")
      .replace(/([?&](?:token|token_hash|access_token|refresh_token|email)=)[^&#]+/gi, "$1<redacted>")
      .replace(/#.*$/, (m) => (/access_token|refresh_token/i.test(m) ? "#<redacted>" : m));
  } catch { return u; }
}

export function initSentry(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.url) event.request.url = scrubUrl(event.request.url);
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      const d = breadcrumb.data as Record<string, unknown> | undefined;
      if (d) {
        for (const key of ["url", "to", "from"]) {
          if (typeof d[key] === "string") d[key] = scrubUrl(d[key] as string);
        }
      }
      return breadcrumb;
    },
  });
}

export function captureError(error: unknown, componentStack?: string | null): void {
  if (!DSN) return;
  Sentry.captureException(
    error,
    componentStack ? { contexts: { react: { componentStack } } } : undefined,
  );
}
