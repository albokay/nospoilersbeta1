import React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { CANON } from "../styles/canon";
import SidebarLogo from "../components/SidebarLogo";

/**
 * Mobile dashboard — the signed-in home of the /m rebuild.
 *
 * CP0 PLACEHOLDER: the real dashboard (groups list + search + personal show
 * buttons, per the mobile rebuild spec) lands in CP3. This screen exists so
 * the post-auth landing spot is real during the rebuild — only admins can
 * reach it (the mobile lockout in App.tsx blocks non-admins from all of /m).
 *
 * Spec conventions already honored here: 100dvh (never 100vh), safe-area
 * insets, canon tokens only.
 */
export default function MobileDashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  // Wait for the session to resolve, then bounce signed-out visitors to the
  // narrative — mirrors DashboardPage's signed-out redirect on desktop.
  if (authLoading) return null;
  if (!user) return <Navigate to="/m" replace />;

  return (
    <div
      style={{
        minHeight: "100dvh",
        boxSizing: "border-box",
        background: "var(--dos-bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        padding:
          "calc(env(safe-area-inset-top, 0px) + 32px) 32px calc(env(safe-area-inset-bottom, 0px) + 32px)",
      }}
    >
      <SidebarLogo scale={1} />
      <p
        style={{
          margin: 0,
          maxWidth: 320,
          fontSize: 16,
          fontWeight: 600,
          lineHeight: 1.5,
          color: CANON.cream,
          textAlign: "center",
        }}
      >
        Mobile dashboard — rebuild in progress.
      </p>
      <button
        onClick={async () => {
          await signOut();
          navigate("/m", { replace: true });
        }}
        style={{
          minHeight: 44,
          padding: "10px 24px",
          borderRadius: 999,
          border: `2px solid ${CANON.cream}`,
          background: "transparent",
          color: CANON.cream,
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Sign out
      </button>
    </div>
  );
}
