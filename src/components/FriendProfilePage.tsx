/**
 * FriendProfilePage — the desktop /pool/:username destination (2026-09-08):
 * the friend-visible "Your shows" world (canon + shelves), replacing the old
 * pool RENDERING at this route. The pool page itself (PublicDashboardPage)
 * survives untouched for the email-invite arrival, which mounts it directly
 * with the `invite` prop — do NOT retire it.
 * Public like the pool always was (get_public_progress is SECURITY DEFINER);
 * logged-out visitors get the sign-in CTA.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../lib/auth";
import { fetchPublicProfileByUsername, fetchContactNames } from "../lib/db";
import SidebarLogo from "./SidebarLogo";
import LoadingDots from "./LoadingDots";
import FeedbackWidget from "./FeedbackWidget";
import FriendProfile from "./profile/FriendProfile";
import { CANON } from "../styles/canon";
import { EDGE_TAB_TOP } from "./dashboardChrome";

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

export default function FriendProfilePage({ username }: { username: string }) {
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
      } catch { if (!cancelled) setNotFound(true); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [username, user?.id]);

  const page: React.CSSProperties = {
    minHeight: "100vh", background: CANON.accent, boxSizing: "border-box",
    fontFamily: '"Inter", system-ui, sans-serif', paddingBottom: 120,
  };

  return (
    <div style={page}>
      {/* Standard left-edge back tab — the same cream partial pill at
          EDGE_TAB_TOP as the show room + group dashboard (Alborz 2026-09-08:
          identical position everywhere; replaces the bare arrow). */}
      <button style={backTab} title="back" onClick={() => navigate(-1)}>
        <ArrowLeft size={24} color={CANON.personal} />
      </button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "16px 24px 0" }}>
        <div
          onClick={() => navigate(user ? "/dashboard" : "/")}
          role="button"
          aria-label="Home"
          title="Home"
          style={{ cursor: "pointer" }}
        >
          <SidebarLogo scale={0.45} blocksOpacity={1} surfaceBg={CANON.accent} />
        </div>
        {!user && (
          <button
            onClick={() => navigate("/")}
            style={{ border: "none", background: CANON.identity, color: CANON.cream, fontWeight: 700, fontSize: 14, padding: "11px 32px", borderRadius: 65, cursor: "pointer", marginTop: 8 }}
          >
            SIGN IN
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 80 }} aria-busy="true">
          <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: CANON.cream }}>loading<LoadingDots /></span>
        </div>
      ) : notFound || !ownerId ? (
        <div style={{ textAlign: "center", marginTop: 80, color: CANON.cream, fontFamily: LORA, fontSize: 24, fontWeight: 700 }}>
          We couldn&rsquo;t find that person.
        </div>
      ) : (
        <div style={{ padding: "28px 24px 0" }}>
          <FriendProfile ownerId={ownerId} ownerName={ownerName} />
        </div>
      )}
      <FeedbackWidget isMobile={false} />
    </div>
  );
}

const backTab: React.CSSProperties = {
  // Identical to the show room / group dashboard back tab (spec §16 tab; one
  // shared height via EDGE_TAB_TOP).
  position: "fixed", left: 0, top: EDGE_TAB_TOP, background: CANON.cream, border: "none", cursor: "pointer",
  borderTopRightRadius: 48, borderBottomRightRadius: 48, padding: "32px 40px 32px 24px",
  display: "inline-flex", alignItems: "center", boxShadow: "6px 6px 18px rgba(0,0,0,0.15)", zIndex: 45,
};
