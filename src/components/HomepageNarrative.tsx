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

// ── Logo + tagline ────────────────────────────────────────────────────────────
function RevealUnit() {
  const { ref, visible } = useReveal(0.2);
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(24px)",
      transition: "opacity 0.9s ease 0.2s, transform 0.9s ease 0.2s",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
    }}>
      <SidebarLogo scale={1} />
      <p style={{
        margin: 0, fontSize: 13, fontWeight: 700,
        letterSpacing: "0.12em", textTransform: "lowercase",
        color: "#fff", opacity: 0.85,
      }}>
        talk. together. whenever.
      </p>
    </div>
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
        <Copy>You're an episode behind your friend.</Copy>
      </section>

      {/* 3 — Friend white bubble, pushed well below copy */}
      <Screen extraTop={120}>
        <Bubble src="/ns-friend.svg" align="left" offset="50%" rate={0.12} />
      </Screen>

      {/* 4 — Copy (38svh) */}
      <section style={{ minHeight: "38svh", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", padding: "48px 32px", boxSizing: "border-box" }}>
        <Copy>Another friend is two episodes behind you.</Copy>
      </section>

      {/* 5 — Cloud: 14 bubbles, high parallax rates for z-depth, wide space around copy */}
      <section style={{ position: "relative", height: "110vh", boxSizing: "border-box" }}>

        {/* Copy anchored at 46% — more breathing room above and below */}
        <div style={{
          position: "absolute", top: "46%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(520px, 80vw)", zIndex: 10,
          padding: "0 0 40px",
        }}>
          <Copy>You're all dying to talk about your favorite show right now.</Copy>
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
          <Copy size={38}>Sidebar is where you can talk freely.</Copy>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <RevealUnit />
        </div>
      </section>
    </>
  );
}
