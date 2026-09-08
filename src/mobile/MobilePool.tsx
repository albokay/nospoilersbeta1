import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { CANON } from "../styles/canon";
import { useAuth } from "../lib/auth";
import SidebarLogo from "../components/SidebarLogo";
import LoadingDots from "../components/LoadingDots";
import FriendProfile from "../components/profile/FriendProfile";
import { fetchPublicProfileByUsername, fetchContactNames } from "../lib/db";

/**
 * MobilePool — since 2026-09-08 this renders the friend-visible PROFILE
 * (canon + shelves via the shared FriendProfile body) instead of the old
 * watch-pool pills; the mount contract is unchanged so nothing upstream
 * moved. (The old pool RENDERING lives on only in the email-invite arrival,
 * which mounts PublicDashboardPage directly.)
 *
 * Two mounts:
 *   • Route (/m/pool/:username) — a full page; back pops history.
 *   • OVERLAY (from a show-room byline tap) — renders on TOP of the
 *     still-mounted room with `overlay` + `onBack`. The room pushes a
 *     history entry when opening, so the iOS edge-swipe (a history pop)
 *     closes the overlay and reveals the room exactly as it was — same
 *     expanded ticket, same scroll, no refetch (the "stable back swipe").
 */

const C = { cream: CANON.cream, yellow: CANON.accent, blue: CANON.identity };
const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export default function MobilePool({ username, overlay = false, onBack }: { username: string; overlay?: boolean; onBack?: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string>(username);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const prof = await fetchPublicProfileByUsername(username);
        if (!prof) { if (!cancelled) { setNotFound(true); setLoading(false); } return; }
        const cn = user ? await fetchContactNames(user.id).catch(() => ({} as Record<string, string>)) : {};
        if (cancelled) return;
        setOwnerId(prof.id);
        // Name chain (naming arc): viewer's contact name → their self-chosen
        // first name → the @handle.
        setOwnerName(cn[prof.id] ?? prof.displayName ?? `@${username}`);
      } catch (e) {
        console.error("[m-pool] load failed", e);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [username, user?.id]);

  const goBack = onBack ?? (() => navigate(-1));
  const rootStyle: React.CSSProperties = overlay
    ? { ...page, background: C.yellow, position: "fixed", inset: 0, zIndex: 1500, overflowY: "auto", WebkitOverflowScrolling: "touch" }
    : { ...page, background: C.yellow };

  if (loading) {
    return (
      <div style={{ ...rootStyle, display: "flex", alignItems: "center", justifyContent: "center" }} aria-busy="true">
        {/* Standard loading line: "loading" + ellipses, Header 2, cream. */}
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: C.cream }}>loading<LoadingDots /></span>
      </div>
    );
  }

  return (
    <div style={rootStyle}>
      <div style={topBar}>
        <button style={iconBtn} title="back" onClick={goBack}>
          <ArrowLeft size={22} color={C.cream} />
        </button>
        <SidebarLogo scale={0.5} blocksOpacity={1} surfaceBg={CANON.accent} />
      </div>

      {notFound || !ownerId ? (
        <div style={{ textAlign: "center", marginTop: 80, color: C.cream, fontFamily: LORA, fontSize: 24, fontWeight: 700, padding: "0 24px" }}>
          We couldn&rsquo;t find that person.
        </div>
      ) : (
        <div style={{ padding: "8px 16px 48px" }}>
          <FriendProfile ownerId={ownerId} ownerName={ownerName} mobile />

          {/* Logged-out visitors get a sign-in CTA (desktop parity). */}
          {!user && (
            <div style={{ textAlign: "center", marginTop: 56 }}>
              <button style={signInPill} onClick={() => navigate("/m")}>SIGN IN</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const page: React.CSSProperties = {
  minHeight: "100dvh", boxSizing: "border-box",
  fontFamily: '"Inter", system-ui, sans-serif',
  paddingBottom: "env(safe-area-inset-bottom, 0px)",
};
// The standard mobile header bar + back arrow (mirrors MobileShowRoom —
// identical position, so the overlay's arrow lands exactly where the room's
// was; Alborz 2026-09-08).
const topBar: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
  padding: "calc(env(safe-area-inset-top, 0px) + 8px) 8px 4px",
};
const iconBtn: React.CSSProperties = {
  width: 44, height: 44, flexShrink: 0, border: "none", background: "transparent", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const signInPill: React.CSSProperties = {
  border: "none", background: C.blue, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "14px 48px", borderRadius: 65, cursor: "pointer",
};
