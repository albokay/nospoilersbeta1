import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// flowType: 'implicit' — recovery + magic-link emails deliver the access
// token via URL hash on the redirect, with no PKCE code-verifier handshake
// required. Switched away from the v2 default ("pkce") because PKCE
// recovery was failing with "Email link is invalid or has expired" on
// every fresh click — the verify endpoint was rejecting tokens it
// couldn't pair with a code_verifier. Implicit recovery is the standard
// pattern for password reset flows; trades the (already minimal) PKCE
// security delta for cross-browser/cross-device link reliability.
// global.fetch override: pass `cache: "no-store"` to every Supabase
// request so PostgREST responses don't get heuristically cached by the
// browser. Without this, a soft refresh of an authenticated data page
// (e.g. /v2/room/:groupId) reuses the previous fetch's cached body —
// new rows written between visits don't show up until a hard refresh,
// which silently breaks the notification-signal pipeline (and any
// other "data should be fresh on visit" UX). Realtime + auth flows go
// through different paths (WebSocket / different endpoints) and are
// unaffected. The mild bandwidth cost is acceptable for an
// authenticated data app where freshness > HTTP-cache wins.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { flowType: 'implicit' },
  global: {
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  },
})
