import React, { useEffect, useRef, useState } from "react";
import SidebarLogo from "./SidebarLogo";

const GREEN = "#7abd8e";
const BUBBLE_MAX = 560; // max bubble width

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

// ── Full-screen section wrapper ───────────────────────────────────────────────
function Screen({ children, center = true }: { children: React.ReactNode; center?: boolean }) {
  return (
    <section style={{
      minHeight: "100svh",
      display: "flex",
      flexDirection: "column",
      alignItems: center ? "center" : "stretch",
      justifyContent: "center",
      padding: "48px 32px",
      boxSizing: "border-box",
    }}>
      {children}
    </section>
  );
}

// ── Bubble ────────────────────────────────────────────────────────────────────
function Bubble({ src, rate = 0.1, align = "center" }: {
  src: string;
  rate?: number;
  align?: "left" | "center" | "right";
}) {
  const { ref: parallaxRef, offset } = useParallax(rate);
  const { ref: revealRef, visible } = useReveal(0.1);

  const justifyMap = { left: "flex-start", center: "center", right: "flex-end" } as const;

  return (
    <div ref={revealRef} style={{
      width: "100%",
      display: "flex",
      justifyContent: justifyMap[align],
      opacity: visible ? 1 : 0,
      transition: "opacity 0.8s ease",
    }}>
      <div ref={parallaxRef} style={{ transform: `translateY(${offset}px)` }}>
        <img
          src={src}
          alt=""
          style={{
            width: `min(${BUBBLE_MAX}px, 90vw)`,
            height: "auto",
            display: "block",
          }}
        />
      </div>
    </div>
  );
}

// ── Copy block ────────────────────────────────────────────────────────────────
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
      textAlign: "center",
      maxWidth: 560,
      margin: "0 auto",
    }}>
      <p style={{
        fontSize: size,
        fontWeight: 800,
        color: "#fff",
        lineHeight: 1.25,
        margin: 0,
      }}>
        {children}
      </p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function HomepageLab() {
  return (
    <div style={{ background: GREEN, minHeight: "100vh", overflowX: "hidden" }}>

      {/* 1 — Your bubble */}
      <Screen>
        <Bubble src="/ns-you.svg" align="center" rate={0.08} />
      </Screen>

      {/* 2 — Copy */}
      <Screen>
        <Copy>You're an episode behind your friend.</Copy>
      </Screen>

      {/* 3 — Friend bubble */}
      <Screen>
        <Bubble src="/ns-friend.svg" align="center" rate={0.12} />
      </Screen>

      {/* 4 — Copy */}
      <Screen>
        <Copy>Another is two episodes behind you.</Copy>
      </Screen>

      {/* 5 — Jumble: staggered bubbles, different alignments */}
      <Screen center={false}>
        <div style={{ display: "flex", flexDirection: "column", gap: 0, width: "100%" }}>
          <Bubble src="/ns-you.svg"    align="left"   rate={0.09} />
          <Bubble src="/ns-friend.svg" align="right"  rate={0.16} />
          <Bubble src="/ns-you.svg"    align="center" rate={0.07} />
          <Bubble src="/ns-friend.svg" align="left"   rate={0.13} />
          <Bubble src="/ns-you.svg"    align="right"  rate={0.11} />
        </div>
      </Screen>

      {/* 6 + 7 + Logo — finale, all in one screen */}
      <Screen>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
          <Copy size={32}>You're all dying to talk about your favorite show.</Copy>
          <Copy size={42} delay={0.15}>Sidebar is where you do.</Copy>
          <div style={{ marginTop: 8 }}>
            <RevealLogo />
          </div>
        </div>
      </Screen>

    </div>
  );
}

function RevealLogo() {
  const { ref, visible } = useReveal(0.2);
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(24px)",
      transition: "opacity 0.9s ease 0.3s, transform 0.9s ease 0.3s",
    }}>
      <SidebarLogo scale={1} />
    </div>
  );
}
