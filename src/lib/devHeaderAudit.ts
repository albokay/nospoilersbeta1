/**
 * Dev-only runtime check that catches the "click silently swallowed by
 * .topHeaderWrap pointer-events: none" bug class.
 *
 * `.topHeaderWrap` has `pointer-events: none` with a narrow allowlist
 * (button/a/input/select/textarea/.brand/.splashSearchWrap/.profileChip).
 * Any custom <div> click target that lands inside without opting back in
 * via the allowlist will silently fail to receive clicks. This module
 * scans the subtree and warns when it finds such a candidate.
 *
 * Heuristic: an element is "likely clickable" if its computed cursor is
 * `pointer` OR if it has a React onClick / onMouseDown handler attached.
 * If such an element ALSO has computed `pointer-events: none`, warn — its
 * clicks are being swallowed.
 *
 * Intentional opt-outs (decorative badges with inline `pointer-events: none`)
 * are skipped.
 */

function getReactClickHandlers(el: Element): string[] {
  const out: string[] = [];
  for (const k of Object.keys(el)) {
    if (!k.startsWith("__reactProps$")) continue;
    const props = (el as any)[k];
    if (!props) continue;
    if (typeof props.onClick === "function") out.push("onClick");
    if (typeof props.onMouseDown === "function") out.push("onMouseDown");
  }
  return out;
}

const warned = new WeakSet<Element>();

function audit(root: Element) {
  const all = root.querySelectorAll("*");
  all.forEach((el) => {
    if (warned.has(el)) return;

    const cs = window.getComputedStyle(el);
    if (cs.pointerEvents !== "none") return;

    // Intentional opt-outs (e.g. decorative badges) set pointer-events
    // explicitly inline. Don't flag those.
    if ((el as HTMLElement).style.pointerEvents === "none") return;

    const handlers = getReactClickHandlers(el);
    const looksClickable = cs.cursor === "pointer" || handlers.length > 0;
    if (!looksClickable) return;

    warned.add(el);
    // eslint-disable-next-line no-console
    console.warn(
      `[topHeaderWrap audit] Click target inside .topHeaderWrap is being silently swallowed by pointer-events: none.\n` +
        `  tag       : <${el.tagName.toLowerCase()}${(el as HTMLElement).className ? ` class="${(el as HTMLElement).className}"` : ""}>\n` +
        `  cursor    : ${cs.cursor}\n` +
        `  handlers  : ${handlers.length ? handlers.join(", ") : "(none detected — flagged via cursor:pointer)"}\n` +
        `  fix       : portal the modal/element out of .topHeaderWrap (see SearchShows onboarding modal),\n` +
        `              or add the wrapping selector to the .topHeaderWrap allowlist in theme.ts.`,
      el
    );
  });
}

export function startHeaderClickAudit() {
  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined") return;

  let observer: MutationObserver | null = null;
  let scheduled = false;
  const schedule = (root: Element) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      audit(root);
    });
  };

  const tryStart = () => {
    const wrap = document.querySelector(".topHeaderWrap");
    if (!wrap) {
      // Header isn't mounted yet (e.g. on the homepage). Retry until it shows up.
      setTimeout(tryStart, 1000);
      return;
    }
    schedule(wrap);
    observer?.disconnect();
    observer = new MutationObserver(() => schedule(wrap));
    observer.observe(wrap, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
  };

  tryStart();
}
