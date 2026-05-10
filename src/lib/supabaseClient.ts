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
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { flowType: 'implicit' }
})
