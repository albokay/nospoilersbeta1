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
function Screen({
  children,
  justify = "center",
  extraTop = 0,
}: {
  children: React.ReactNode;
  justify?: React.CSSProperties["justifyContent"];
  extraTop?: number;
}) {
  return (
    <section style={{
      minHeight: "100svh",
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      justifyContent: justify,
      padding: `${48 + extraTop}px 32px 48px`,
      boxSizing: "border-box",
    }}>
      {children}
    </section>
  );
}

// ── Bubble ────────────────────────────────────────────────────────────────────
function Bubble({ src, rate = 0.1, align = "center", offset: inset = "0%" }: {
  src: string;
  rate?: number;
  align?: "left" | "center" | "right";
  offset?: string;
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
          style={{ width: `min(${BUBBLE_MAX}px, 90vw)`, height: "auto", display: "block" }} />
      </div>
    </div>
  );
}

// ── Copy ──────────────────────────────────────────────────────────────────────
function Copy({ children, size = 32, delay = 0 }: {
  children: React.ReactNode;
  size?: number;
  delay?: number;
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

// ── Logo + tagline reveal ─────────────────────────────────────────────────────
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

      {/* 2 — Copy */}
      <Screen>
        <Copy>You're an episode behind your friend.</Copy>
      </Screen>

      {/* 3 — Friend white bubble, left half */}
      <Screen>
        <Bubble src="/ns-friend.svg" align="left" offset="50%" rate={0.12} />
      </Screen>

      {/* 4 — Copy */}
      <Screen>
        <Copy>Another is two episodes behind you.</Copy>
      </Screen>

      {/* 5 — Jumble: tightly packed, no parallax to avoid clipping */}
      <section style={{ padding: "0 32px", boxSizing: "border-box" }}>
        <Bubble src="/ns-friend.svg" align="left"  offset="42%" rate={0.13} />
        <Bubble src="/ns-you.svg"    align="right" offset="38%" rate={0.09} />
        <Bubble src="/ns-friend.svg" align="left"  offset="36%" rate={0.16} />
        <div style={{ padding: "72px 0", display: "flex", justifyContent: "center" }}>
          <Copy>You're all dying to talk about your favorite show.</Copy>
        </div>
        <Bubble src="/ns-you.svg"    align="right" offset="42%" rate={0.11} />
        <Bubble src="/ns-friend.svg" align="left"  offset="40%" rate={0.14} />
        <Bubble src="/ns-you.svg"    align="right" offset="34%" rate={0.10} />
      </section>

      {/* 6 — Finale: copy high, logo+tagline centered */}
      <section style={{
        minHeight: "100svh", display: "flex", flexDirection: "column",
        padding: "48px 32px", boxSizing: "border-box",
      }}>
        <div style={{ paddingTop: "8svh", display: "flex", justifyContent: "center" }}>
          <Copy size={38}>Sidebar is where you can talk freely.</Copy>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <RevealUnit />
        </div>
      </section>
    </>
  );
}
