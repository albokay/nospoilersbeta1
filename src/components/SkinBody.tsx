import { useEffect } from "react";
import { useEditorial } from "../lib/skin";

/** The page behind every page (Alborz's notes, round 3): under the editorial
 *  skin the body paints cream (the strip under the home indicator in the
 *  home-screen app showed the classic green or sky), and the browser's
 *  theme colour follows. Mounted once at the app root; renders nothing. */
export default function SkinBody() {
  const editorial = useEditorial();
  useEffect(() => {
    document.body.classList.toggle("skin-editorial", editorial);
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta?.getAttribute("content") ?? null;
    if (editorial && meta) meta.setAttribute("content", "#FEF8EA");
    return () => {
      document.body.classList.remove("skin-editorial");
      if (meta && prev) meta.setAttribute("content", prev);
    };
  }, [editorial]);
  return null;
}
