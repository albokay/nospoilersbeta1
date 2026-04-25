import React, { useEffect, useRef, useState } from "react";
import SidebarLogo from "./SidebarLogo";

const BUBBLE_MAX = 560;

// ── Scroll-reveal ─────────────────────────────────────────────────────────────
function useReveal(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setVisible(true);
    }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

// ── Parallax ──────────────────────────────────────────────────────────────────
function useParallax(rate = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    function onScroll() {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const center = rect.top + rect.height / 2 - window.innerHeight / 2;
      setOffset(center * rate);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [rate]);
  return { ref, offset };
}

// ── Full-screen section ───────────────────────────────────────────────────────
function Screen({ children, justify = "center", extraTop = 0 }: {
  children: React.ReactNode;
  justify?: React.CSSProperties["justifyContent"];
  extraTop?: number;
}) {
  return (
    <section style={{
      minHeight: "100svh", display: "flex", flexDirection: "column",
      alignItems: "stretch", justifyContent: justify,
      padding: `${48 + extraTop}px 32px 48px`, boxSizing: "border-box",
    }}>
      {children}
    </section>
  );
}

// ── Flow bubble (for solo screens) ───────────────────────────────────────────
function Bubble({ src, rate = 0.1, align = "center", offset: inset = "0%", scale = 1 }: {
  src: string; rate?: number;
  align?: "left" | "center" | "right"; offset?: string; scale?: number;
}) {
  const { ref: parallaxRef, offset } = useParallax(rate);
  const { ref: revealRef, visible } = useReveal(0.1);
  const justifyMap = { left: "flex-start", center: "center", right: "flex-end" } as const;
  const padding = align === "right" ? { paddingLeft: inset }
    : align === "left" ? { paddingRight: inset } : {};
  return (
    <div ref={revealRef} style={{
      width: "100%", display: "flex", justifyContent: justifyMap[align],
      boxSizing: "border-box", ...padding,
      opacity: visible ? 1 : 0, transition: "opacity 0.8s ease",
    }}>
      <div ref={parallaxRef} style={{ transform: `translateY(${offset}px)` }}>
        <img src={src} alt=""
          style={{ width: `min(${Math.round(BUBBLE_MAX * scale)}px, 90vw)`, height: "auto", display: "block" }} />
      </div>
    </div>
  );
}

// ── Cloud bubble (absolutely positioned, vw-based) ────────────────────────────
// left / top / width are CSS strings (e.g. "12vw", "18%")
function CloudBubble({ src, top, left, width, rate = 0 }: {
  src: string; top: string; left: string; width: string; rate?: number;
}) {
  const { ref: parallaxRef, offset } = useParallax(rate);
  const { ref: revealRef, visible } = useReveal(0.05);
  return (
    <div ref={revealRef} style={{
      position: "absolute", top, left, width,
      opacity: visible ? 1 : 0, transition: "opacity 0.9s ease",
      pointerEvents: "none",
    }}>
      <div ref={parallaxRef} style={{ transform: `translateY(${offset}px)` }}>
        <img src={src} alt="" style={{ width: "100%", height: "auto", display: "block" }} />
      </div>
    </div>
  );
}

// ── Copy ──────────────────────────────────────────────────────────────────────
function Copy({ children, size = 32, delay = 0 }: {
  children: React.ReactNode; size?: number; delay?: number;
}) {
  const { ref, visible } = useReveal(0.3);
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(32px)",
      transition: `opacity 0.8s ease ${delay}s, transform 0.8s ease ${delay}s`,
      textAlign: "center", maxWidth: 560, margin: "0 auto",
    }}>
      <p style={{ fontSize: size, fontWeight: 800, color: "#fff", lineHeight: 1.25, margin: 0 }}>
        {children}
      </p>
    </div>
  );
}

// SidebarLogo intrinsic size at scale=1 (from component source: W=280, H=148)
const LOGO_W = 280;
const LOGO_H = 148;
const TAGLINE_H = 28;  // fontSize 13 + line spacing
const LOGO_GAP = 8;
const UNIT_H = LOGO_H + LOGO_GAP + TAGLINE_H;

// ── Animated logo: scrolls from finale center → top-left corner ──────────────
// Key design: ONE SidebarLogo instance, always mounted in a fixed container.
// It runs its scatter animation silently on page load (off-screen / opacity 0)
// so by the time the user scrolls to the finale, blocks are already settled.
// The in-flow placeholder is an empty invisible div — layout space + reveal hook only.
function AnimatedLogo({ headerHeight = 56 }: { headerHeight?: number }) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [anim, setAnim] = useState({ progress: 0, left: 0, top: 0, measured: false });
  const { ref: revealRef, visible } = useReveal(0.15);

  useEffect(() => {
    function onScroll() {
      const el = placeholderRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const centerY = rect.top + UNIT_H / 2;
      // Start when logo center is at top ~22% — snaps before logo can escape the top edge
      const startY = vh * 0.22;
      const endY = 4 + (LOGO_H * 0.6) / 2;
      const rawProgress = (startY - centerY) / (startY - endY);
      const progress = Math.min(Math.max(rawProgress, 0), 1);
      setAnim({ progress, left: rect.left, top: rect.top, measured: true });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [headerHeight]);

  const { progress, left: natLeft, top: natTop, measured } = anim;
  // Ease-in: barely moves at first, then snaps quickly into corner
  const eased = progress * progress;

  const TARGET_SCALE = 0.6;
  const TARGET_LEFT = 32;
  const TARGET_TOP = Math.max(4, (headerHeight - LOGO_H * TARGET_SCALE) / 2) + 16;

  const scale = 1 + (TARGET_SCALE - 1) * eased;
  const taglineOpacity = (1 - eased) * 0.85;
  // The 5 colored blocks dissolve in lockstep with the shrink, so by
  // the time the logo has settled into its small header position,
  // only the type-only wordmark PNG remains visible. Linear in eased
  // (which is itself progress * progress) — feels coupled to the
  // shrink without a separate easing curve to reason about.
  const blocksOpacity = 1 - eased;

  // GPU-composited positioning: fixed at origin, transform handles all movement.
  // translate(x,y) positions the top-left; scale(s) shrinks from that corner.
  // No left/top updates = no layout recalc = no jank/float feeling.
  const tx = measured ? natLeft + (TARGET_LEFT - natLeft) * eased : -9999;
  const ty = measured ? natTop  + (TARGET_TOP  - natTop)  * eased : -9999;
  const animating = progress > 0;

  return (
    <>
      {/* Empty in-flow placeholder — reserves layout space, hosts reveal detector */}
      <div ref={placeholderRef} style={{ width: LOGO_W, height: UNIT_H, visibility: "hidden", flexShrink: 0 }}>
        <div ref={revealRef} style={{ width: "100%", height: "100%" }} />
      </div>

      {/* Single SidebarLogo — always mounted, never conditionally unmounted.
          Runs its scatter animation silently on page load (off-screen / opacity 0).
          Uses GPU-composited transform for positioning to eliminate scroll jank. */}
      <div style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: LOGO_W,
        height: UNIT_H,
        transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        transformOrigin: "0 0",
        willChange: "transform",
        zIndex: 96,
        pointerEvents: "none",
        display: "flex", flexDirection: "column", alignItems: "center", gap: LOGO_GAP,
        opacity: visible ? 1 : 0,
        transition: (!animating && visible) ? "opacity 0.9s ease 0.2s" : "none",
      }}>
        <SidebarLogo scale={1} blocksOpacity={blocksOpacity} />
        <p style={{
          margin: 0, fontSize: 13, fontWeight: 700,
          letterSpacing: "0.12em", textTransform: "lowercase",
          color: "#fff", opacity: taglineOpacity, flexShrink: 0,
        }}>
          talk. together. whenever.
        </p>
      </div>
    </>
  );
}

// ── Narrative ─────────────────────────────────────────────────────────────────
export default function HomepageNarrative({ headerHeight = 56 }: { headerHeight?: number }) {
  return (
    <>
      {/* 1 — Opening blue bubble, centered */}
      <Screen extraTop={headerHeight}>
        <Bubble src="/ns-you.svg" align="center" rate={0.08} />
      </Screen>

      {/* 2 — Copy (38svh) */}
      <section style={{ minHeight: "38svh", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", padding: "48px 32px", boxSizing: "border-box" }}>
        <Copy>You're an episode<br />behind your friend.</Copy>
      </section>

      {/* 3 — Friend white bubble, pushed well below copy */}
      <Screen extraTop={120}>
        <Bubble src="/ns-friend.svg" align="left" offset="50%" rate={0.12} />
      </Screen>

      {/* 4 — Copy (38svh) */}
      <section style={{ minHeight: "38svh", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", padding: "48px 32px", boxSizing: "border-box" }}>
        <Copy>Another friend is two<br />episodes behind you.</Copy>
      </section>

      {/* 5 — Cloud: 14 bubbles, high parallax rates for z-depth, wide space around copy */}
      <section style={{ position: "relative", height: "110vh", boxSizing: "border-box" }}>

        {/* Copy anchored at 46% + 25px lower */}
        <div style={{
          position: "absolute", top: "calc(46% + 25px)", left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(520px, 80vw)", zIndex: 10,
          padding: "0 0 40px",
        }}>
          <Copy>You're all dying to talk about<br />your favorite show right now.</Copy>
        </div>

        {/* Above copy — spread evenly across full width, no right-side clustering */}
        <CloudBubble src="/ns-friend.svg" top="1%"  left="4vw"  width="24vw" rate={0.22} />
        <CloudBubble src="/ns-you.svg"    top="2%"  left="66vw" width="26vw" rate={0.14} />
        <CloudBubble src="/ns-friend.svg" top="11%" left="34vw" width="22vw" rate={0.28} />
        <CloudBubble src="/ns-you.svg"    top="10%" left="62vw" width="20vw" rate={0.18} />
        <CloudBubble src="/ns-friend.svg" top="20%" left="8vw"  width="26vw" rate={0.24} />
        <CloudBubble src="/ns-you.svg"    top="19%" left="46vw" width="24vw" rate={0.20} />
        <CloudBubble src="/ns-friend.svg" top="29%" left="24vw" width="22vw" rate={0.16} />
        <CloudBubble src="/ns-you.svg"    top="28%" left="60vw" width="26vw" rate={0.26} />

        {/* Below copy — evenly spread, no overlapping columns */}
        <CloudBubble src="/ns-friend.svg" top="58%" left="5vw"  width="26vw" rate={0.26} />
        <CloudBubble src="/ns-you.svg"    top="59%" left="52vw" width="24vw" rate={0.18} />
        <CloudBubble src="/ns-friend.svg" top="68%" left="30vw" width="24vw" rate={0.22} />
        <CloudBubble src="/ns-you.svg"    top="67%" left="64vw" width="22vw" rate={0.14} />
        <CloudBubble src="/ns-friend.svg" top="78%" left="10vw" width="28vw" rate={0.20} />
        <CloudBubble src="/ns-you.svg"    top="77%" left="44vw" width="26vw" rate={0.24} />
      </section>

      {/* 6 — Finale: whole unit pushed 250px lower via extra section height */}
      <section style={{
        minHeight: "calc(100svh + 250px)", display: "flex", flexDirection: "column",
        padding: "48px 32px 64px", boxSizing: "border-box",
        justifyContent: "flex-end",
      }}>
        <div style={{ marginBottom: 450, display: "flex", justifyContent: "center" }}>
          <Copy size={38}>Sidebar is where<br />you can talk freely.</Copy>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <AnimatedLogo headerHeight={headerHeight} />
        </div>
      </section>
    </>
  );
}
