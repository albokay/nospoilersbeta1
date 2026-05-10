import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const KEY = "ns_beta_access";

export function useBetaAccess() {
  return localStorage.getItem(KEY) === "1";
}

export default function BetaGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem(KEY) === "1");
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  // /reset-password is exempt from the gate. The recovery token in the URL
  // hash is single-use and consumed by supabase-js on page load — if the
  // gate intercepts and reloads/redirects, the token is lost and the user
  // can never reset. Conceptually they already have an account (so they
  // already cleared the gate at signup); regating is redundant. Checked
  // synchronously via window.location since BetaGate sits outside any
  // router.
  const onResetPasswordPath =
    typeof window !== "undefined" && window.location.pathname.startsWith("/reset-password");

  // Mobile redirect: when the gate triggers on a mobile viewport, send the
  // user to /m before rendering the password form. Without this, returning
  // to a backgrounded mobile tab after the gate re-arms could leave the
  // desktop shell stuck on "Loading..."; /m's mobile shell renders cleanly.
  // BetaGate sits outside the RouterProvider so we use window.location
  // rather than useNavigate. Skip this redirect on /reset-password — see
  // exemption above (mobile users on a recovery link should land on the
  // page directly without the /m bounce).
  useEffect(() => {
    if (unlocked) return;
    if (onResetPasswordPath) return;
    if (typeof window === "undefined") return;
    const isMobile = window.innerWidth < 768;
    const onMobilePath = window.location.pathname.startsWith("/m");
    if (isMobile && !onMobilePath) {
      window.location.replace("/m");
    }
  }, [unlocked, onResetPasswordPath]);

  if (unlocked || onResetPasswordPath) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    try {
      const { data, error: rpcError } = await supabase.rpc("check_beta_password", {
        attempt: input,
      });
      if (rpcError) throw rpcError;
      if (data === true) {
        localStorage.setItem(KEY, "1");
        setUnlocked(true);
      } else {
        setError(true);
        setInput("");
      }
    } catch {
      setError(true);
      setInput("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f5f5f5" }}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, width: 280 }}>
        <input
          autoFocus
          type="password"
          placeholder="password"
          value={input}
          onChange={e => { setInput(e.target.value); setError(false); }}
          style={{ padding: "10px 14px", fontSize: 15, border: "1px solid #ccc", borderRadius: 6, outline: "none" }}
        />
        {error && <div style={{ fontSize: 13, color: "#c00" }}>incorrect password</div>}
        <button type="submit" disabled={loading} style={{ padding: "10px 14px", fontSize: 15, background: "#222", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
          {loading ? "checking…" : "enter"}
        </button>
      </form>
    </div>
  );
}
