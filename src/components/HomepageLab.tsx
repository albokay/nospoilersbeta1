import React, { useEffect, useRef, useState } from "react";
import SidebarLogo from "./SidebarLogo";

const GREEN = "#7abd8e";
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

// ── Full-screen section — every element gets its own ─────────────────────────
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <section style={{
      minHeight: "100svh",
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      justifyContent: "center",
      padding: "48px 32px",
      boxSizing: "border-box",
    }}>
      {children}
    </section>
  );
}

// ── Bubble ────────────────────────────────────────────────────────────────────
// pl / pr: left/right padding as % strings to nudge bubble toward a side
function Bubble({ src, rate = 0.1, pl = "0%", pr = "0%" }: {
  src: string;
  rate?: number;
  pl?: string;
  pr?: string;
}) {
  const { ref: parallaxRef, offset } = useParallax(rate);
  const { ref: revealRef, visible } = useReveal(0.1);

  return (
    <div ref={revealRef} style={{
      width: "100%",
      paddingLeft: pl,
      paddingRight: pr,
      boxSizing: "border-box",
      opacity: visible ? 1 : 0,
      transition: "opacity 0.8s ease",
    }}>
      <div ref={parallaxRef} style={{ transform: `translateY(${offset}px)` }}>
        <img
          src={src}
          alt=""
          style={{ width: `min(${BUBBLE_MAX}px, 90vw)`, height: "auto", display: "block" }}
        />
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
      textAlign: "center",
      maxWidth: 560,
      margin: "0 auto",
    }}>
      <p style={{ fontSize: size, fontWeight: 800, color: "#fff", lineHeight: 1.25, margin: 0 }}>
        {children}
      </p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function HomepageLab() {
  return (
    <div style={{ background: GREEN, minHeight: "100vh", overflowX: "hidden" }}>

      {/* 1 — Opening blue bubble, pushed right */}
      <Screen>
        <Bubble src="/ns-you.svg" pl="35%" rate={0.08} />
      </Screen>

      {/* 2 — Copy */}
      <Screen>
        <Copy>You're an episode behind your friend.</Copy>
      </Screen>

      {/* 3 — Friend white bubble, pushed to left half */}
      <Screen>
        <Bubble src="/ns-friend.svg" pr="50%" rate={0.12} />
      </Screen>

      {/* 4 — Copy */}
      <Screen>
        <Copy>Another is two episodes behind you.</Copy>
      </Screen>

      {/* 5–11 — Jumble: each bubble its own Screen, copy woven in */}

      {/* white → left */}
      <Screen>
        <Bubble src="/ns-friend.svg" pr="42%" rate={0.13} />
      </Screen>

      {/* blue → right */}
      <Screen>
        <Bubble src="/ns-you.svg" pl="38%" rate={0.09} />
      </Screen>

      {/* white → left, slight variation */}
      <Screen>
        <Bubble src="/ns-friend.svg" pr="36%" rate={0.16} />
      </Screen>

      {/* copy woven into the mess */}
      <Screen>
        <Copy>You're all dying to talk about your favorite show.</Copy>
      </Screen>

      {/* blue → right, variation */}
      <Screen>
        <Bubble src="/ns-you.svg" pl="42%" rate={0.11} />
      </Screen>

      {/* white → left */}
      <Screen>
        <Bubble src="/ns-friend.svg" pr="40%" rate={0.14} />
      </Screen>

      {/* blue → right */}
      <Screen>
        <Bubble src="/ns-you.svg" pl="34%" rate={0.10} />
      </Screen>

      {/* 12 — Finale: copy + logo + tagline as a centered unit */}
      <Screen>
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 64,
        }}>
          <Copy size={38}>Sidebar is where you can talk freely.</Copy>
          <RevealUnit />
        </div>
      </Screen>

    </div>
  );
}

function RevealUnit() {
  const { ref, visible } = useReveal(0.2);
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(24px)",
      transition: "opacity 0.9s ease 0.2s, transform 0.9s ease 0.2s",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 16,
    }}>
      <SidebarLogo scale={1} />
      <p style={{
        margin: 0,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "lowercase",
        color: "#fff",
        opacity: 0.85,
      }}>
        talk. together. whenever.
      </p>
    </div>
  );
}
