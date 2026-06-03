import React from "react";

/**
 * Top-level error boundary — the "friendly crash screen" half of the
 * pre-beta error-tracking item (HANDOFF §"Outstanding action items").
 *
 * Catches render-time crashes anywhere below it and shows a recoverable
 * screen instead of a blank page. This is IN-APP ONLY: errors are logged
 * locally (console) but NOT reported anywhere remote yet — so this does
 * NOT give us visibility into what's breaking for testers. A real reporter
 * (probably Sentry) plugs into `componentDidCatch` below as the single hook
 * point. See the project memory note for that follow-up.
 *
 * Scope reminder: React error boundaries only catch errors thrown WHILE
 * rendering. They do NOT catch failures in event handlers (button clicks)
 * or async/background work (Supabase calls) — those still land in
 * console.warn as before. A real tracker is what closes that gap.
 *
 * The fallback screen deliberately uses hardcoded canon colors and no
 * imported components, because the crash may have happened before the
 * theme CSS was injected (App injects it in an effect) or inside a shared
 * dependency. Keeping the screen self-contained means it can always render.
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Local-only for now. When we wire a real reporter (Sentry et al.),
    // this is the one place to forward the error + componentStack.
    console.error("[Sidebar] Unhandled render error:", error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) return <ErrorScreen />;
    return this.props.children;
  }
}

function ErrorScreen() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: "32px 24px",
        textAlign: "center",
        background: "#7abd8e", // canon green (--dos-bg default surface)
        color: "#FFFFFF",
        fontFamily:
          "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: "0.005em" }}>
        Oops, something went wrong.
      </h1>
      <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.5, fontSize: 16 }}>
        Sidebar ran into an unexpected problem. Reloading the page usually clears it.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: "transparent",
            color: "#FFFFFF",
            border: "2px solid #FFFFFF",
            borderRadius: 24,
            padding: "10px 22px",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Reload Sidebar
        </button>
        <button
          type="button"
          onClick={() => window.location.assign("/")}
          style={{
            background: "transparent",
            color: "rgba(255,255,255,0.85)",
            border: "none",
            padding: "10px 12px",
            fontSize: 15,
            fontWeight: 500,
            cursor: "pointer",
            textDecoration: "underline",
            fontFamily: "inherit",
          }}
        >
          Back to start
        </button>
      </div>
      <p style={{ margin: 0, marginTop: 8, maxWidth: 420, lineHeight: 1.5, fontSize: 15, color: "rgba(255,255,255,0.85)" }}>
        Once you’re back on track, please use the Feedback tab to leave a message about how
        you got to this error message.
      </p>
    </div>
  );
}
