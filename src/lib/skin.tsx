/**
 * skin.tsx — which look an account sees (the editorial skin's switch,
 * checkpoint 1, 2026-10-10; docs/editorial-skin-plan.md §1).
 *
 * Two looks: "classic" (the live site as it is) and "editorial" (the round-3
 * design, built page by page behind this switch). Nothing changes for anyone
 * until their account says so:
 *
 *   • profiles.skin — 'classic' | 'editorial', default 'classic' for every
 *     existing and new account. The profile loader (auth.tsx) reads it; the
 *     account card lets an editorial account (or an admin) switch back and
 *     forth; the admin page flips any account.
 *   • ?skin=editorial in the address — for the signed-out surfaces (the
 *     homepage, an invitee's arrival), remembered for the visit in
 *     sessionStorage so the look holds across the pages of that visit.
 *     ?skin=classic clears it. Nobody who doesn't type it sees it.
 *
 * useSkin() answers "editorial" when either says so. Screens branch once at
 * the top: `const editorial = useEditorial();` — the data under both looks is
 * the same.
 */
import { createContext, useContext, useSyncExternalStore } from "react";
import { useAuthOptional } from "./auth";
import { fetchSiteSkin } from "./db";

export type Skin = "classic" | "editorial";

export function asSkin(v: unknown): Skin {
  return v === "editorial" ? "editorial" : "classic";
}

const VISIT_KEY = "ns_skin_visit";

/** The visit's override, read once from the address on load and remembered
 *  for the tab's session. */
function readVisitSkin(): Skin | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("skin");
    if (q === "editorial" || q === "classic") {
      window.sessionStorage.setItem(VISIT_KEY, q);
      return q;
    }
    const stored = window.sessionStorage.getItem(VISIT_KEY);
    return stored === "editorial" || stored === "classic" ? stored : null;
  } catch {
    return null;
  }
}

const VISIT_SKIN: Skin | null = readVisitSkin();

export function visitSkin(): Skin | null {
  return VISIT_SKIN;
}

// ── The site's look (Alborz 2026-10-13): site_settings.default_skin, which
//    every account follows unless its own row says otherwise. Read once per
//    load; the last value is remembered in localStorage so a page paints in
//    the right look at once (a brand-new browser may show one classic paint
//    before the first read lands). The admin's flip updates it in place.
const SITE_KEY = "ns_site_skin";
function readCachedSiteSkin(): Skin | null {
  try {
    const v = window.localStorage.getItem(SITE_KEY);
    return v === "editorial" || v === "classic" ? v : null;
  } catch { return null; }
}
let siteSkin: Skin | null = typeof window === "undefined" ? null : readCachedSiteSkin();
const siteListeners = new Set<() => void>();
export function setSiteSkinLocal(s: Skin | null): void {
  siteSkin = s;
  try { if (s) window.localStorage.setItem(SITE_KEY, s); else window.localStorage.removeItem(SITE_KEY); } catch { /* fine */ }
  siteListeners.forEach((l) => l());
}
function subscribeSite(l: () => void): () => void { siteListeners.add(l); return () => { siteListeners.delete(l); }; }
let siteFetched = false;
function ensureSiteSkin(): void {
  if (siteFetched || typeof window === "undefined") return;
  siteFetched = true;
  fetchSiteSkin().then((s) => { if (s !== siteSkin) setSiteSkinLocal(s); }).catch(() => { /* classic stays */ });
}
/** The site's look, live. */
export function useSiteSkin(): Skin | null {
  return useSyncExternalStore(subscribeSite, () => siteSkin, () => siteSkin);
}
ensureSiteSkin();

/** The look this account (or this visit) sees: the account's own pick,
 *  else the address's visit flag, else the site's look, else classic. */
export function useSkin(): Skin {
  const profile = useAuthOptional()?.profile;
  const site = useSiteSkin();
  if (profile?.skin === "editorial") return "editorial";
  if (profile?.skin === "classic") return "classic";
  if (VISIT_SKIN) return VISIT_SKIN;
  return site ?? "classic";
}

export function useEditorial(): boolean {
  return useSkin() === "editorial";
}

/** The editorial scope: true inside a surface already drawn under the skin
 *  (the feed's wrapper provides it), so leaf pieces that float out of it —
 *  the notes papers, the note box, the pick card — take the same look
 *  without a prop through every layer. */
export const EditorialScope = createContext<boolean>(false);
export function useEditorialScope(): boolean {
  return useContext(EditorialScope);
}
