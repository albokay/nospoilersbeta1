// Inline animated ellipsis — three dots pulsing in staggered sequence.
// Reuses the existing .invite-dot CSS in theme.ts (keyframes + :nth-child
// delays). Wrapped in a container so the nth-child selectors count dots
// relative to the wrapper, not whatever parent text/element precedes the
// component. Inherits color from the surrounding text.
//
// Typical use:
//   <button>Saving<LoadingDots /></button>
//   <div>Loading your profile<LoadingDots /></div>
//   <button>{loading ? <LoadingDots /> : "Sign in"}</button>
export default function LoadingDots() {
  return (
    <span className="loading-dots" aria-hidden="true">
      <span className="invite-dot">.</span>
      <span className="invite-dot">.</span>
      <span className="invite-dot">.</span>
    </span>
  );
}
