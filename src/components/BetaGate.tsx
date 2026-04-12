import React, { useState } from "react";

const KEY = "ns_beta_access";
const PASSWORD = "mayaewk!osNOWi";

export function useBetaAccess() {
  return localStorage.getItem(KEY) === "1";
}

export default function BetaGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem(KEY) === "1");
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input === PASSWORD) {
      localStorage.setItem(KEY, "1");
      setUnlocked(true);
    } else {
      setError(true);
      setInput("");
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
        <button type="submit" style={{ padding: "10px 14px", fontSize: 15, background: "#222", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          enter
        </button>
      </form>
    </div>
  );
}
