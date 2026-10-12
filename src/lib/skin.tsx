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
import { useAuth } from "./auth";

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

/** The look this account (or this visit) sees. */
export function useSkin(): Skin {
  const { profile } = useAuth();
  if (profile?.skin === "editorial") return "editorial";
  if (VISIT_SKIN === "editorial") return "editorial";
  return "classic";
}

export function useEditorial(): boolean {
  return useSkin() === "editorial";
}
