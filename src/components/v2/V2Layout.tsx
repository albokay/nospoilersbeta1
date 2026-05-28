import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { LogOut, BookOpen, BookMarked, ArrowLeft, ArrowRight, UserPen } from "lucide-react";
import FeedbackWidget from "../FeedbackWidget";
import SidebarLogo from "../SidebarLogo";
import SidebarAvatar from "../SidebarAvatar";
import Tooltip from "../Tooltip";

type Palette = "journal" | "profile" | "compose" | "room";

type V2LayoutProps = {
  palette: Palette;
  pairedHeader?: { left: string; rightLabel: string; rightTo: string };
  // When true, V2Layout skips its centered max-width <main> and renders
  // children directly. Used by surfaces that manage their own page
  // geometry — e.g. V2ComposePage (manages its own root + animation),
  // V2FriendRoomPage (manages its own two-pane layout).
  bareMain?: boolean;
  children: React.ReactNode;
};

// V2 palette strategy:
//  - "journal"   → default body palette (green via --dos-bg, set in theme.ts).
//                  No body class, no inline bg override.
//  - "profile"   → toggle body.public-context (mustard) — the existing class
//                  used by the live public space, so all theme tokens flip.
//  - "compose"   → cream paint, applied as body bg via a v2-only class.
//
// Chrome strategy (logo + sign-out + profile pill):
//   v2 sits OUTSIDE AppShell, but rather than draw its own bespoke chrome
//   we reuse AppShell's existing CSS classes (.topHeaderWrap, .topHeaderBand,
//   .topHeaderLeft, .topHeaderRight, .topHeaderPillFixed, .profileChip).
//   This guarantees pixel-identical placement of the logo / sign-out /
//   profile pill across /v3/journal (in AppShell) and /v2/* (in V2Layout) —
//   the user perceives one continuous frame as they navigate. Without this
//   reuse the chrome jumped between pages because AppShell and v2 each had
//   their own positioning code.
export default function V2Layout({ palette, pairedHeader, bareMain, children }: V2LayoutProps) {
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();

  useEffect(() => {
    const cls =
      palette === "profile" ? "public-context"
      : palette === "compose" ? "v2-compose-context"
      : palette === "room" ? "group-context"
      : null;
    if (cls) document.body.classList.add(cls);
    // has-header flips the body gradient so the lighter band sits at the
    // bottom — the live site toggles this in AppShell for every non-
    // homepage route. v2 sits outside AppShell, so we toggle it here.
    document.body.classList.add("has-header");
    return () => {
      if (cls) document.body.classList.remove(cls);
      document.body.classList.remove("has-header");
    };
  }, [palette]);

  // Are we on a profile-family surface? Profile/journal/compose all render
  // the "you are {username}" identity pill (cursor:default — you're home).
  // The friend-room palette is the navigation case: the user is OFF their
  // home base, so the pill flips to "go to your journal" with a click
  // handler. This matches the AppShell convention applied to /v3/journal vs
  // /show/<id> in the live site.
  const onProfileFamily = palette !== "room";

  return (
    <div style={{ minHeight: "100vh", position: "relative" }}>
      {/* Compose-palette bg paint — kept inline so we don't grow theme.ts */}
      {palette === "compose" && (
        <style>{`body.v2-compose-context{background:#fef8ea !important}`}</style>
      )}

      {/* Unified fixed chrome — uses AppShell's CSS classes so positioning
          matches /v3/journal exactly. Pointer-events allowlist on the wrap
          re-enables interaction for buttons / brand / pill children only
          (the rest of the wrap area is click-through). */}
      <div className="topHeaderWrap">
        <div className="topHeaderBand">
          {/* Left: brand logo, navigates to v3 journal on click */}
          <div className="topHeaderLeft">
            <h1
              className="brand"
              style={{ margin: 0, cursor: "pointer", marginLeft: 16 }}
              tabIndex={0}
              role="button"
              aria-label="Go to your journal"
              onClick={() => {
                navigate("/journal");
                requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate("/journal");
                }
              }}
            >
              <SidebarLogo scale={0.6} />
            </h1>
          </div>

          {/* Right: sign-out (visible always — was previously hidden inside
              an account dropdown, which broke the "always-visible sign-out"
              expectation set by AppShell). Tooltip + LogOut icon match
              AppShell's treatment 1:1. */}
          <div className="topHeaderRight">
            {user && (
              <Tooltip text="Sign out" direction="below" tooltipStyle={{ width: "auto", whiteSpace: "nowrap", padding: "6px 10px" }}>
                <button
                  className="btn"
                  style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px 10px" }}
                  onClick={() => { navigate("/"); signOut(); }}
                  aria-label="Sign out"
                >
                  <LogOut size={16} color="currentColor" />
                </button>
              </Tooltip>
            )}
            {!user && (
              <button className="btn" style={{ flexShrink: 0 }} onClick={() => navigate("/")}>
                Sign in / Join
              </button>
            )}
          </div>
        </div>

        {/* Profile pill — own fixed-position element via .topHeaderPillFixed
            so its right edge aligns with the journal/profile content column
            (math is in theme.ts). Same .profileChip styling and behavior
            as AppShell. cursor:default on profile-family because we ARE on
            the user's home base — pill is identity, not navigation.
            On non-profile-family pages (palette === "room"), a SECOND pill
            ("go to your profile") renders directly after the journal pill —
            same dimensions, white outline + transparent fill + white text,
            with icons mirrored to the right of the label. */}
        {user && profile && (
          <span className="topHeaderPillFixed" style={{ display: "inline-flex", gap: 8 }}>
            <button
              className="profileChip"
              onClick={onProfileFamily ? undefined : () => {
                navigate("/journal");
                requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
              }}
              style={onProfileFamily ? { cursor: "default" } : undefined}
            >
              {onProfileFamily ? (
                <>
                  <BookOpen size={16} color="#fff" style={{ flexShrink: 0 }} />
                  <span className="profileChipLabel" style={{ fontWeight: 700, color: "#fff", display: "inline-flex", alignItems: "center", gap: 6 }}>you are <SidebarAvatar userId={user.id} username={profile.username} size={18} />{profile.username}</span>
                </>
              ) : (
                <>
                  <BookMarked size={16} color="#fff" style={{ flexShrink: 0 }} />
                  <ArrowLeft size={14} color="#fff" style={{ flexShrink: 0 }} />
                  <span className="profileChipLabel" style={{ fontWeight: 700, color: "#fff" }}>go to your journal</span>
                </>
              )}
            </button>
            {!onProfileFamily && (
              <button
                className="profileChip"
                onClick={() => {
                  navigate("/profile");
                  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
                }}
                // Override .profileChip's filled canon-blue background with
                // outlined/transparent. box-sizing:border-box (inherited from
                // .profileChip) keeps the 34px height including the new
                // 2px border, so visual sizing matches the journal pill.
                style={{
                  background: "transparent",
                  border: "2px solid #fff",
                }}
              >
                <span className="profileChipLabel" style={{ fontWeight: 700, color: "#fff" }}>go to your profile</span>
                <ArrowRight size={14} color="#fff" style={{ flexShrink: 0 }} />
                <UserPen size={16} color="#fff" style={{ flexShrink: 0 }} />
              </button>
            )}
          </span>
        )}
      </div>

      {bareMain ? (
        children
      ) : (
        // Container width matches the live + v3 journal exactly:
        //   - .container = min(672px, 92vw) centered (theme.ts:233)
        //   - .journalShift on the ancestor activates the +56px margin-left
        //     on .profile-journal-heading at ≥731px (theme.ts:450) — so the
        //     heading's left edge lands at the same x-coord as V3's heading.
        // Top padding mirrors V3's effective offset:
        //   AppShell renders <header className="site bleed" /> in flow
        //   above V3JournalPage, taking var(--site-header-h) px (56 wide /
        //   96 narrow). V3's inner container then adds marginTop: 12.
        //   V2 has no .site header, so we replicate the same offset via
        //   calc(var(--site-header-h) + 12px). Net: heading sits at the
        //   exact same y-coord as V3's heading on every viewport — no
        //   vertical jump when navigating between /v3/journal and /v2/*.
        <main
          className="container journalShift"
          style={{
            padding: "calc(var(--site-header-h) + 12px) 0 120px",
          }}
        >
          {pairedHeader && (
            // Heading + companion link — geometry matches V3JournalPage's
            // "this is your journal" + "→ go to your public profile" pair
            // (gap 16, marginBottom 12, baseline alignment, flexWrap) so
            // the two surfaces share identical heading placement. The
            // .profile-journal-heading class pairs with .journalShift on
            // the ancestor to land the heading 56px in from the container
            // left edge, matching V3.
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 16,
                marginBottom: 12,
                flexWrap: "wrap",
                minHeight: 28,
              }}
            >
              <div
                className="title profile-journal-heading"
                style={{ fontSize: 22 }}
              >
                {pairedHeader.left}
              </div>
              {/* Lora italic 16, white-outline transparent-fill pill, full-
                  opacity white text. Pill radius matches the site's .btn
                  convention (9999px). Arrow lives inside the pill. */}
              <a
                href={pairedHeader.rightTo}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(pairedHeader.rightTo);
                }}
                style={{
                  fontFamily: "Lora, Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 16,
                  color: "#fff",
                  background: "transparent",
                  border: "2px solid #fff",
                  borderRadius: 9999,
                  padding: "6px 14px",
                  textDecoration: "none",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  lineHeight: 1.2,
                }}
              >
                <ArrowRight size={14} /> {pairedHeader.rightLabel}
              </a>
            </div>
          )}

          {children}
        </main>
      )}

      {/* feedback tab — always available across v2 surfaces. Same component
          + same backing store as live; isMobile=false because v2 is
          desktop-only (mobile lockout still routes <768px to /m). */}
      <FeedbackWidget isMobile={false} />
    </div>
  );
}
