/**
 * MobileAddToHomeScreen — the mobile dashboard's "add Sidebar to your home
 * screen" button (home-screen app arc, 2026-08-18; Alborz's mock: a big cream
 * circle with a thin green "+", Lora cream caption in two lines beneath).
 *
 * ONE button, one label, platform-adaptive behavior (see lib/installPrompt):
 *   • Chrome/Edge (Android + desktop) → the browser's REAL install dialog.
 *   • iPhone/iPad in Safari → a cream bottom sheet: share icon → Add to Home
 *     Screen → Add (Apple exposes no install API — the guide IS the most a
 *     page can do).
 *   • iPhone in Chrome/Firefox → same guide, share icon at the top right.
 *   • iPhone inside another app's browser (Gmail, Instagram…) → same guide
 *     with an "open this page in Safari first" step in front.
 *   • Anything else → a generic browser-menu guide.
 * Hidden entirely once installed / when already running as the app.
 * Mobile only for now (Alborz 2026-08-18; desktop later).
 */
import React, { useEffect, useState } from "react";
import { Plus, Share, X } from "lucide-react";
import { CANON } from "../styles/canon";
import useSheetSwipeDown from "../lib/useSheetSwipeDown";
import { canPromptInstall, promptInstall, onInstallPromptChange, isStandalone, installPath, type InstallPath } from "../lib/installPrompt";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export default function MobileAddToHomeScreen() {
  const [, bump] = useState(0);
  const [guide, setGuide] = useState<InstallPath | null>(null);
  useEffect(() => onInstallPromptChange(() => bump((n) => n + 1)), []);
  const swipe = useSheetSwipeDown(() => setGuide(null));

  if (isStandalone()) return null;

  async function onTap() {
    if (canPromptInstall()) { await promptInstall(); return; }
    setGuide(installPath());
  }

  return (
    <>
      {/* The button IS the app icon (Alborz 2026-08-18, pass #2): the real
          home-screen icon with a drop shadow so green-on-green reads, and a
          small encircled "+" tucked over its bottom-left corner. */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 64, padding: "0 24px" }}>
        <button onClick={onTap} aria-label="Add Sidebar to your home screen" style={iconBtn}>
          <img src="/icons/icon-192.png" alt="" draggable={false} style={iconImg} />
          <span style={plusBadge}><Plus size={18} strokeWidth={1.6} color={CANON.personal} /></span>
        </button>
        <div style={caption}>add Sidebar to<br />your home screen</div>
      </div>

      {guide && (
        <div style={dim} onClick={() => setGuide(null)}>
          <div {...swipe.handlers} style={{ ...sheet, ...swipe.style }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setGuide(null)} aria-label="Close" style={closeX}>
              <X size={18} color={CANON.dark} />
            </button>
            <div style={title}>Add Sidebar to your home screen</div>
            <GuideBody path={guide} />
          </div>
        </div>
      )}
    </>
  );
}

function GuideBody({ path }: { path: InstallPath }) {
  const shareGlyph = (
    <span style={glyph} aria-label="share icon"><Share size={13} strokeWidth={2.2} /></span>
  );
  if (path === "generic") {
    return (
      <>
        <Step n={1}>Open your browser&rsquo;s menu.</Step>
        <Step n={2}>Choose <b>Install app</b> or <b>Add to Home screen</b>.</Step>
        <p style={foot}>(You&rsquo;ll sign in once inside the app.)</p>
      </>
    );
  }
  const where = path === "ios-chrome" ? "at the top right" : "at the bottom of Safari";
  return (
    <>
      {path === "ios-webview" && (
        <div style={callout}>
          First, open this page in Safari — look for <b>Open in Safari</b> in this app&rsquo;s menu.
        </div>
      )}
      <Step n={1}>{path === "ios-webview" ? "Then tap" : "Tap"} the share icon {shareGlyph} {where}.</Step>
      <Step n={2}>Scroll down and choose <b>Add to Home Screen</b>.</Step>
      <Step n={3}>Tap <b>Add</b>. Sidebar opens like an app from now on.</Step>
      {/* No "not seeing it?" hedge in the Safari guide (Alborz 2026-08-18).
          Trade-off, eyes open: the Safari-flavored viewer some apps embed
          (Twitter/Slack/Reddit) is UA-indistinguishable from real Safari and
          lacks Add to Home Screen — those users get no hint. */}
      <p style={foot}>(You&rsquo;ll sign in once inside the app.)</p>
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 10 }}>
      <span style={num}>{n}</span>
      <span style={stepText}>{children}</span>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const iconBtn: React.CSSProperties = {
  position: "relative", width: 88, height: 88, border: "none", background: "transparent",
  padding: 0, cursor: "pointer", WebkitTapHighlightColor: "transparent", display: "block",
};
const iconImg: React.CSSProperties = {
  width: 88, height: 88, display: "block", borderRadius: 20,
  boxShadow: "0 8px 22px rgba(0,0,0,0.28)",
};
// The encircled "+", overlapping the icon's bottom-left corner.
const plusBadge: React.CSSProperties = {
  position: "absolute", left: -12, bottom: -10, width: 32, height: 32, borderRadius: "50%",
  background: CANON.cream, display: "inline-flex", alignItems: "center", justifyContent: "center",
  boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
};
const caption: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 22, lineHeight: 1.25, letterSpacing: 0,
  color: CANON.cream, textAlign: "center", marginTop: 26,
};
const dim: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, background: "rgba(26,58,74,0.35)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
};
// Left-justified cream bottom sheet (the mobile bottom-sheet rule).
const sheet: React.CSSProperties = {
  position: "relative", width: "100%", boxSizing: "border-box", background: CANON.cream,
  borderTopLeftRadius: 24, borderTopRightRadius: 24,
  padding: "22px 24px calc(env(safe-area-inset-bottom, 0px) + 26px)",
  boxShadow: "0 -8px 28px rgba(0,0,0,0.28)",
};
const closeX: React.CSSProperties = {
  position: "absolute", top: 8, right: 8, width: 44, height: 44, border: "none", background: "transparent",
  cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const title: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 22, letterSpacing: 0, color: CANON.identity, margin: "0 36px 6px 0",
};
const stepText: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif', fontSize: 14, lineHeight: 1.5, color: CANON.dark,
};
const num: React.CSSProperties = {
  flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: CANON.identity, color: CANON.cream,
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1,
};
const glyph: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20,
  border: `1.5px solid ${CANON.identity}`, borderRadius: 5, color: CANON.identity, verticalAlign: "-5px", margin: "0 2px",
};
const callout: React.CSSProperties = {
  background: CANON.friend, borderRadius: 10, padding: "10px 12px", marginTop: 8,
  fontFamily: '"Inter", sans-serif', fontSize: 14, lineHeight: 1.45, color: CANON.dark, fontWeight: 600,
};
const foot: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.5, color: CANON.dark, opacity: 0.7,
  fontStyle: "italic", margin: "12px 0 0",
};
