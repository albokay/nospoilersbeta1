// Feature flags. Read at build time from Vite env.
//
// Convention: flag is OFF when unset. Set the env var to the literal
// string "true" in Vercel / Netlify / .env.local to enable.

export const FEATURE_PINGS_POLLS =
  import.meta.env.VITE_FEATURE_PINGS_POLLS === "true";
