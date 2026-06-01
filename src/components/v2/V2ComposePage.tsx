import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ComposeForm from "./ComposeForm";
import { useAuth } from "../../lib/auth";

// Standalone full-page route wrapper at `/compose/:showId`. Owns:
//   - the cream-palette body classes (compose's writing-paper visual is
//     painted via body.v2-compose-context; that only makes sense on a
//     full-page surface, NOT in a modal where the page beneath stays
//     visible — the modal carries its own cream card paint)
//   - the rating-flow + returnTo entry markers, read from location.state
//     (passed in by callsites that previously navigated here)
//   - the discard + post-publish navigation logic, because the route
//     EXITS to another page in both cases
//
// As of the modal arc (2026-05), in-app callers route through
// useComposeModal().open(...) instead of navigating here. This route
// remains mounted so any pre-existing deep links / bookmarks continue to
// work, and to preserve a debugging fallback for the standalone form.
export default function V2ComposePage({ showId }: { showId?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();

  // Rating-flow entry markers (preserved for any direct callers that
  // still navigate here with state). fromRating drives intro-copy variant
  // inside ComposeForm; returnTo overrides the default /journal
  // discard target.
  const fromRating = Boolean((location.state as { fromRating?: boolean } | null)?.fromRating);
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;

  // Cream palette + has-header gradient flip. Self-managed (not via
  // V2Layout) so we can run our own dark ink color scheme without
  // overloading the public-context palette tokens. Only applied in
  // standalone mode — modal mode paints cream on the card itself.
  useEffect(() => {
    document.body.classList.add("v2-compose-context", "has-header");
    return () => {
      document.body.classList.remove("v2-compose-context", "has-header");
    };
  }, []);

  // Discard navigation — preserves the original V2ComposePage logic
  // (returnTo if set, else /journal with activeTab seeded).
  function handleCancel() {
    if (returnTo) {
      navigate(returnTo);
      return;
    }
    if (showId) navigate("/journal", { state: { activeTab: showId } });
    else navigate("/journal");
  }

  // Post-publish navigation — private → journal with private-lane filter,
  // public → the author's own public room (public-rooms scope, 2026; the
  // show-wide aggregate is no longer navigable), friend-room → V2 room.
  function handleSubmitted(destination: "private" | "public" | string, threadId?: string) {
    if (destination === "private") {
      // Open the new private post directly (V1 thread view) rather than the
      // journal, where it wouldn't be visible until a manual refresh.
      if (showId && threadId) {
        sessionStorage.removeItem(`ns_active_group_${showId}`);
        navigate(`/show/${showId}/thread/${threadId}`);
      } else {
        navigate("/journal", { state: { activeTab: showId, activeFilter: "private" } });
      }
    } else if (destination === "public") {
      if (showId && profile?.username) {
        navigate(`/u/${profile.username}/show/${showId}/posts`, { state: { publishedThreadId: threadId } });
      } else {
        navigate("/journal");
      }
    } else {
      navigate(`/room/${destination}`);
    }
  }

  return (
    <ComposeForm
      showId={showId}
      fromRating={fromRating}
      onCancel={handleCancel}
      onSubmitted={handleSubmitted}
    />
  );
}
