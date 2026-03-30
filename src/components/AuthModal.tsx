import React, { useState } from "react";
import Modal from "./Modal";
import { useAuth } from "../lib/auth";

type Mode = "signin" | "signup";

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    let err: string | null = null;
    if (mode === "signup") {
      if (!username.trim()) { setError("Please choose a username."); setLoading(false); return; }
      if (username.trim().length < 3) { setError("Username must be at least 3 characters."); setLoading(false); return; }
      err = await signUp(email.trim(), password, username.trim());
    } else {
      err = await signIn(email.trim(), password);
    }

    setLoading(false);
    if (err) { setError(err); return; }
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <h3 className="title" style={{ margin: 0, fontSize: 20 }}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </h3>
        <button className="btn" onClick={onClose}>✕</button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
        {mode === "signup" && (
          <input
            className="badge"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={{ height: 40, width: "100%" }}
            autoFocus
            autoComplete="off"
          />
        )}
        <input
          className="badge"
          placeholder="Email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ height: 40, width: "100%" }}
          autoFocus={mode === "signin"}
          autoComplete="email"
        />
        <input
          className="badge"
          placeholder="Password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ height: 40, width: "100%" }}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{error}</div>
        )}

        <button
          className="btn btn-danger"
          type="submit"
          disabled={loading}
          style={{ height: 40, marginTop: 4 }}
        >
          {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <div style={{ marginTop: 14, textAlign: "center", fontSize: 13 }} className="muted">
        {mode === "signin" ? (
          <>No account?{" "}
            <button
              onClick={() => { setMode("signup"); setError(null); }}
              style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: "var(--dos-fg)", fontSize: 13 }}
            >
              Create one
            </button>
          </>
        ) : (
          <>Already have an account?{" "}
            <button
              onClick={() => { setMode("signin"); setError(null); }}
              style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", color: "var(--dos-fg)", fontSize: 13 }}
            >
              Sign in
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
