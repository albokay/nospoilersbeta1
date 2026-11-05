/**
 * HomeScreenTab — the phone's "Get Sidebar as an app" tab and its drawer
 * (his design, 2026-11-04, canvas 8MvnJ8xb72PuK4AoZ8Dbb3; replaces the
 * underlined "Add Sidebar to your home screen →" line under the dashboard's
 * group rows).
 *
 * The TAB: a square docked at the foot beside the deck's "How I/we watch TV"
 * tab — the same height and hairline frame, cream, the app's five blocks
 * drawn against the whole square (the icon IS the tab); a 12px gap keeps the
 * two reading as separate elements, and the How tab gives up its right end
 * for it (editorial/Dashboard's DrawerTab reads `homeScreenTabInset`). It
 * docks on the dashboard and the group room, even before the How tab shows;
 * never in the installed app (`isStandalone`), never on desktop, never in a
 * show room (his call).
 *
 * The DRAWER: the editorial bottom sheet — the icon (rounded, lifted off the
 * cream by a centred shadow) beside "Get Sidebar as an app", then the one
 * part that applies: Android/Chrome → an ink block that fires the browser's
 * real install dialog; iPhone Safari (or Chrome) → the three share-icon
 * steps; inside another app's browser → a paper note "open this page in
 * Safari first" before the steps; anything else → the browser-menu steps.
 * No "not now": swipe down or tap the veil. No explaining what an app is.
 */
import React, { useEffect, useState } from "react";
import { Share } from "lucide-react";
import { E } from "../../styles/editorial";
import { BottomSheet } from "./Overlays";
import { canPromptInstall, promptInstall, onInstallPromptChange, installPath, homeScreenTabDocked, HOME_SCREEN_TAB, type InstallPath } from "../../lib/installPrompt";

/** The app icon's five blocks (scripts/generate-app-icons.mjs: 0.288 side,
 *  15/52 corners, the 0.92 composition), on whatever cream the parent gives.
 *  His redesign (11-04): the staircase's cream block is GREEN, so the icon
 *  sits on cream — the dock square and the drawer draw the same mark the
 *  phone's icon files will carry (CP3). */
export function AppIconBlocks({ style }: { style?: React.CSSProperties }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" style={{ width: "100%", height: "100%", display: "block", ...style }}>
      <rect x="9.52" y="11.36" width="26.5" height="26.5" rx="7.64" fill={E.color.alert} />
      <rect x="28.38" y="31.14" width="26.5" height="26.5" rx="7.64" fill={E.color.accent} />
      <rect x="43.56" y="20.56" width="26.5" height="26.5" rx="7.64" fill={E.color.personal} />
      <rect x="53.68" y="65.64" width="26.5" height="26.5" rx="7.64" fill={E.color.identity} />
      <rect x="65.64" y="50.46" width="26.5" height="26.5" rx="7.64" fill={E.color.friend} />
    </svg>
  );
}

export default function HomeScreenTab() {
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);
  // A late `beforeinstallprompt` (Chrome fires it early, but not always
  // before this mounts) changes which drawer shows.
  useEffect(() => onInstallPromptChange(() => bump((n) => n + 1)), []);
  if (!homeScreenTabDocked()) return null;
  return (
    <>
      <button
        type="button" aria-label="Get Sidebar as an app" title="Get Sidebar as an app" onClick={() => setOpen(true)}
        style={{
          position: "fixed", bottom: 0, right: 44, zIndex: 40,
          width: HOME_SCREEN_TAB, height: `calc(${HOME_SCREEN_TAB}px + env(safe-area-inset-bottom, 0px))`, boxSizing: "border-box",
          padding: `0 0 env(safe-area-inset-bottom, 0px)`,
          border: `1px solid ${E.color.ink}`, borderBottom: 0, background: E.color.cream,
          cursor: "pointer", WebkitTapHighlightColor: "transparent",
        }}
      >
        <AppIconBlocks />
      </button>
      {open && <HomeScreenDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

/** The drawer. The head row (icon + heading) rides in the sheet's own head
 *  slot; the body is the one path's content. */
function HomeScreenDrawer({ onClose }: { onClose: () => void }) {
  const path = installPath();
  const [busy, setBusy] = useState(false);
  async function install() {
    if (busy) return;
    setBusy(true);
    try { await promptInstall(); } finally { setBusy(false); onClose(); }
  }
  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div aria-hidden="true" style={{ width: 56, height: 56, flexShrink: 0, background: E.color.cream, borderRadius: 12, overflow: "hidden", boxShadow: "0 0 16px rgba(26,58,74,0.32)" }}>
        <AppIconBlocks />
      </div>
      <div className="sb-balance" style={{ ...E.type.letterTitle22, maxWidth: 240 }}>Get Sidebar as an app</div>
    </div>
  );
  return (
    <BottomSheet onClose={onClose} head={head} label="Get Sidebar as an app">
      {path === "prompt" && canPromptInstall() ? (
        <>
          <button type="button" onClick={() => { void install(); }} disabled={busy} style={{ ...E.type.button16, width: "100%", height: 54, border: 0, background: E.color.ink, color: E.color.cream, cursor: "pointer", marginTop: 10, opacity: busy ? 0.7 : 1, WebkitTapHighlightColor: "transparent" }}>
            {busy ? "one moment" : "Add to home screen"}
          </button>
          <p style={{ ...E.type.note13, color: E.color.inkMuted, margin: "14px 0 0" }}>Your browser asks once. You&rsquo;ll sign in once inside the app.</p>
        </>
      ) : (
        <GuideSteps path={path} />
      )}
    </BottomSheet>
  );
}

/** The steps for a browser without an install dialog. */
function GuideSteps({ path }: { path: InstallPath }) {
  const shareGlyph = (
    <span role="img" aria-label="share icon" style={{ display: "inline-flex", verticalAlign: -3, margin: "0 2px" }}><Share size={16} strokeWidth={2} /></span>
  );
  if (path === "generic" || path === "prompt") {
    return (
      <div style={{ ...rows, marginTop: 10 }}>
        <Step n={1}>Open your browser&rsquo;s menu.</Step>
        <Step n={2}>Choose <b>Install app</b> or <b>Add to Home screen</b>.</Step>
        <Foot />
      </div>
    );
  }
  const where = path === "ios-chrome" ? "at the top right" : "at the bottom of Safari";
  return (
    <>
      {path === "ios-webview" && (
        <div className="sb-balance" style={{ ...E.type.note13, boxSizing: "border-box", padding: "12px 14px 13px 13px", border: `1px solid ${E.color.ink}`, borderLeft: `5px solid ${E.color.accent}`, marginTop: 10 }}>
          First, open this page in Safari. Look for <b>Open in Safari</b> in this app&rsquo;s menu.
        </div>
      )}
      <div style={{ ...rows, marginTop: path === "ios-webview" ? 18 : 10 }}>
        <Step n={1}>{path === "ios-webview" ? "Then tap" : "Tap"} the share icon {shareGlyph} {where}.</Step>
        <Step n={2}>Scroll down and choose <b>Add to Home Screen</b>.</Step>
        <Step n={3}>Tap <b>Add</b>. Sidebar opens like an app from now on.</Step>
        <Foot />
      </div>
    </>
  );
}

const rows: React.CSSProperties = { display: "flex", flexDirection: "column", borderTop: `1px solid ${E.color.hairline}` };

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 0", borderBottom: `1px solid ${E.color.hairline}` }}>
      <span aria-hidden="true" style={{ ...E.type.label11, width: 22, height: 22, borderRadius: "50%", background: E.color.ink, color: E.color.cream, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, letterSpacing: 0 }}>{n}</span>
      <span style={E.type.body15}>{children}</span>
    </div>
  );
}

function Foot() {
  return <p style={{ ...E.type.note13, color: E.color.inkMuted, margin: "14px 0 0" }}>You&rsquo;ll sign in once inside the app.</p>;
}
