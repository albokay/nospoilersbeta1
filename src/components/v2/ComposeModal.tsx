import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import ComposeForm, { type ComposeFormHandle } from "./ComposeForm";

// Compose-form-cream + ink colors mirrored from ComposeForm so the modal
// card's chrome (close button, etc.) reads as part of the writing surface.
const CREAM_BG = "#fef8ea";
const INK_SOFT = "#5a4d3a";
const RULE = "rgba(43, 36, 24, 0.32)";

// Modal sizing — approximated from the mockup. The cream "framing" space
// around the inner writing card emerges from the size delta between the
// modal box (% of viewport) and the form's fixed-width <main> inside it.
const MODAL_WIDTH_VW  = 85;
const MODAL_HEIGHT_VH = 90;

export type ComposeModalOpenArgs = {
  /** Show whose compose page to open. Required — compose without a show
   *  doesn't make sense. */
  showId: string;
  /** Where to navigate on discard. Modal-mode default is "stay put" (just
   *  close the modal), so this is only consulted when the discard target
   *  differs from the caller's current pathname. */
  returnTo?: string;
  /** Rating-flow entry marker — drives the intro-copy variant inside
   *  ComposeForm. Forwarded as-is. */
  fromRating?: boolean;
};

type ComposeModalContextValue = {
  /** Open the compose modal. Caller passes the show id (required) plus
   *  optional returnTo + fromRating. The modal handles its own dismiss +
   *  post-submit navigation; no callbacks needed at the open-site. */
  open: (args: ComposeModalOpenArgs) => void;
};

const ComposeModalContext = createContext<ComposeModalContextValue | null>(null);

/** Hook consumed by every write-button / rating-flow callsite. Throws if
 *  no provider is mounted upstream (catches config errors early). */
export function useComposeModal(): ComposeModalContextValue {
  const ctx = useContext(ComposeModalContext);
  if (!ctx) {
    throw new Error("useComposeModal must be used inside a ComposeModalProvider");
  }
  return ctx;
}

/** Mount once at the App tree root (inside BrowserRouter + AuthProvider).
 *  Holds the open/close state and renders the modal when open. The
 *  modal portals to document.body so it escapes any ancestor stacking
 *  context. */
export function ComposeModalProvider({ children }: { children: React.ReactNode }) {
  const [args, setArgs] = useState<ComposeModalOpenArgs | null>(null);
  const navigate = useNavigate();
  const formRef = useRef<ComposeFormHandle>(null);

  const open = useCallback((newArgs: ComposeModalOpenArgs) => {
    setArgs(newArgs);
  }, []);

  const close = useCallback(() => {
    setArgs(null);
  }, []);

  // ── Body scroll lock while open ────────────────────────────────────
  // The page beneath stays visible (per spec: "page below is visible
  // through 0.2 alpha tint"), but the user shouldn't be able to scroll
  // the underlying surface while the modal is up. The modal card itself
  // has its own internal overflow:auto for the form content.
  useEffect(() => {
    if (!args) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [args]);

  // ── Escape key triggers the form's discard flow ────────────────────
  // Routes through attemptDiscard (via imperative ref) so the dirty-check
  // + confirm modal fires correctly. Direct close-on-Escape would silently
  // drop the user's draft.
  useEffect(() => {
    if (!args) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        formRef.current?.attemptDiscard();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [args]);

  // ── onCancel ────────────────────────────────────────────────────────
  // Close the modal. If returnTo was set AND differs from the current
  // pathname, navigate there (covers the "discard sends me back to where
  // I came from" case). Otherwise the user just stays on the page they
  // were on when they opened the modal.
  const handleCancel = useCallback(() => {
    const t = args;
    close();
    if (t?.returnTo && t.returnTo !== window.location.pathname) {
      navigate(t.returnTo);
    }
  }, [args, close, navigate]);

  // ── onSubmitted ────────────────────────────────────────────────────
  // Close the modal + navigate to the destination, mirroring the
  // standalone V2ComposePage post-publish landing logic exactly:
  //   private → /v3/journal with activeTab seeded + private-lane filter
  //   public  → /show/<id> (V1 public conversation surface)
  //   group   → /v2/room/<groupId> + state.publishedThreadId
  //     The latter is read by V2FriendRoomPage as a "refetch + expand"
  //     signal — without it, a same-room publish (user wrote from the
  //     friend room they're going back to) doesn't trigger a remount,
  //     so the new entry is missing from the page's already-loaded
  //     feedEntries until the user manually refreshes.
  const handleSubmitted = useCallback(
    (destination: "private" | "public" | string, threadId: string) => {
      const showId = args?.showId;
      close();
      if (destination === "private") {
        navigate("/v3/journal", { state: { activeTab: showId, activeFilter: "private" } });
      } else if (destination === "public") {
        if (showId) navigate(`/show/${showId}`);
        else navigate("/v3/journal");
      } else {
        navigate(`/v2/room/${destination}`, { state: { publishedThreadId: threadId } });
      }
    },
    [args, close, navigate],
  );

  return (
    <ComposeModalContext.Provider value={{ open }}>
      {children}
      {args && createPortal(
        <ComposeModalShell formRef={formRef}>
          <ComposeForm
            ref={formRef}
            showId={args.showId}
            fromRating={args.fromRating}
            onCancel={handleCancel}
            onSubmitted={handleSubmitted}
            hideTopRightClose
          />
        </ComposeModalShell>,
        document.body,
      )}
    </ComposeModalContext.Provider>
  );
}

// ── Modal shell ────────────────────────────────────────────────────────
// Backdrop + cream card + top-right × button. Card sizing in vw/vh per
// Q7 so the cream "framing" around the form scales with the viewport.
// Internal overflow:auto so a tall draft scrolls inside the card.
function ComposeModalShell({
  children,
  formRef,
}: {
  children: React.ReactNode;
  formRef: React.RefObject<ComposeFormHandle>;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          position: "relative",
          width: `${MODAL_WIDTH_VW}vw`,
          height: `${MODAL_HEIGHT_VH}vh`,
          background: CREAM_BG,
          borderRadius: 24,
          boxShadow: "0 12px 36px rgba(0,0,0,0.25)",
          overflow: "auto",
        }}
      >
        {/* Modal's own × button — sits in the card's top-right corner
            (absolute positioning relative to the card, not the viewport
            like the standalone page's fixed-positioned button). Triggers
            the form's existing dirty-check + confirm flow via the
            imperative ref so the user's draft can't get silently dropped. */}
        <button
          onClick={() => formRef.current?.attemptDiscard()}
          aria-label="Discard and close"
          style={{
            position: "absolute",
            top: 20,
            right: 24,
            background: "transparent",
            border: `2px solid ${RULE}`,
            color: INK_SOFT,
            borderRadius: 9999,
            padding: "8px 18px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            height: 34,
            zIndex: 10,
          }}
        >
          × not now
        </button>
        {children}
      </div>
    </div>
  );
}
