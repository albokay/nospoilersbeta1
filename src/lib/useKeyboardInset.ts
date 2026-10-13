import { useEffect, useState } from "react";

/** The on-screen keyboard's height (Alborz's notes, round 3). iOS Safari
 *  leaves the layout viewport alone and only shrinks the visual one, so a
 *  sheet fixed at the bottom sits under the keyboard; this reads the visual
 *  viewport and the sheets add the inset. 0 on desktop and with no keyboard. */
export default function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);
  return inset;
}
