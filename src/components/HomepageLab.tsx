import React, { useEffect, useRef, useState } from "react";
import SidebarLogo from "./SidebarLogo";

// ── Bubble image ──────────────────────────────────────────────────────────────
// The SVGs are 1440×810 with the bubble centered around x=432–1008, y=332–470.
// We display as a cropped viewport so only the bubble is visible.
const BUBBLE_W = 320; // rendered width of the visible bubble area
const BUBBLE_H = 90;  // rendered height
// The SVG viewBox is 1440×810; bubble region is roughly x=420,y=320 w=590 h=160
// We set the img intrinsic size to fill that crop.
const SVG_VW = 1440;
const SVG_VH = 810;
const CROP_X = 420, CROP_Y = 318, CROP_W = 600, CROP_H = 165;
const SCALE = BUBBLE_W / CROP_W;
const IMG_W = SVG_VW * SCALE;   // natural img width so crop region = BUBBLE_W
const IMG_H = SVG_VH * SCALE;
const OFFSET_X = -(CROP_X * SCALE);
const OFFSET_Y = -(CROP_Y * SCALE);

function Bubble({ src, align }: { src: string; align: "left" | "right" | "center" }) {
  return (
    <div style={{
      width: BUBBLE_W,
      height: BUBBLE_H,
      overflow: "hidden",
      flexShrink: 0,
      alignSelf: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
    }}>
      <img
        src={src}
        alt=""
        style={{
          width: IMG_W,
          height: IMG_H,
          display: "block",
          transform: `translate(${OFFSET_X}px, ${OFFSET_Y}px)`,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ── Scroll-reveal hook ────────────────────────────────────────────────────────
function useReveal(threshold = 0.25) {
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

// ── Parallax hook ─────────────────────────────────────────────────────────────
function useParallax(rate = 0.15) {
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

// ── Section components ────────────────────────────────────────────────────────
function RevealSection({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(28px)",
      transition: `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s`,
    }}>
      {children}
    </div>
  );
}

function ParallaxBubble({ src, align, rate }: { src: string; align: "left" | "right" | "center"; rate?: number }) {
  const { ref, offset } = useParallax(rate ?? 0.12);
  const { ref: revealRef, visible } = useReveal(0.1);
  return (
    <div ref={revealRef} style={{
      opacity: visible ? 1 : 0,
      transition: "opacity 0.6s ease",
      display: "flex",
      justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
    }}>
      <div ref={ref} style={{ transform: `translateY(${offset}px)` }}>
        <Bubble src={src} align="center" />
      </div>
    </div>
  );
}

// ── Copy text style ───────────────────────────────────────────────────────────
const copyStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  color: "#1a1a1a",
  lineHeight: 1.3,
  textAlign: "center",
  maxWidth: 520,
  margin: "0 auto",
};

// ── Main component ────────────────────────────────────────────────────────────
export default function HomepageLab() {
  return (
    <div style={{
      background: "#fff",
      minHeight: "100vh",
      paddingBottom: 120,
      overflowX: "hidden",
    }}>

      {/* ── 1. Opening bubble: "No spoilers!" (you) ── */}
      <section style={{ paddingTop: 140, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <ParallaxBubble src="/ns-you.svg" align="center" rate={0.08} />
      </section>

      {/* ── 2. Copy: you're behind ── */}
      <section style={{ padding: "120px 24px 0" }}>
        <RevealSection>
          <p style={copyStyle}>You're an episode behind your friend.</p>
        </RevealSection>
      </section>

      {/* ── 3. Friend bubble ── */}
      <section style={{ padding: "120px 48px 0" }}>
        <ParallaxBubble src="/ns-friend.svg" align="right" rate={0.14} />
      </section>

      {/* ── 4. Copy: another is behind you ── */}
      <section style={{ padding: "120px 24px 0" }}>
        <RevealSection>
          <p style={copyStyle}>Another is two episodes behind you.</p>
        </RevealSection>
      </section>

      {/* ── 5. Jumble of bubbles ── */}
      <section style={{ padding: "120px 48px 0", display: "flex", flexDirection: "column", gap: 24 }}>
        <ParallaxBubble src="/ns-you.svg"    align="left"   rate={0.10} />
        <ParallaxBubble src="/ns-friend.svg" align="right"  rate={0.18} />
        <ParallaxBubble src="/ns-you.svg"    align="center" rate={0.08} />
        <ParallaxBubble src="/ns-friend.svg" align="left"   rate={0.14} />
        <ParallaxBubble src="/ns-you.svg"    align="right"  rate={0.12} />
      </section>

      {/* ── 6. Copy: dying to talk ── */}
      <section style={{ padding: "140px 24px 0" }}>
        <RevealSection>
          <p style={copyStyle}>You're all dying to talk about your favorite show.</p>
        </RevealSection>
      </section>

      {/* ── 7. Copy: Sidebar is where you do ── */}
      <section style={{ padding: "80px 24px 0" }}>
        <RevealSection delay={0.1}>
          <p style={{ ...copyStyle, fontSize: 36 }}>Sidebar is where you do.</p>
        </RevealSection>
      </section>

      {/* ── 8. Logo ── */}
      <section style={{ padding: "80px 24px 0", display: "flex", justifyContent: "center" }}>
        <RevealSection delay={0.2}>
          <SidebarLogo scale={1} />
        </RevealSection>
      </section>

    </div>
  );
}
