import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import type { User } from "@supabase/supabase-js";

type Profile = { id: string; username: string; is_seed: boolean; is_admin: boolean; bio: string | null; onboarded_at: string | null };

type AuthCtx = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, username: string) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  // Re-reads the current user's profile row into context. Called after the
  // onboarding flow stamps onboarded_at so first-login routing/gating sees
  // the fresh value without a full reload.
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    // Column-tolerant cascade (same pattern as the bio fallback — see §6
    // item 28 in HANDOFF). Try the fullest select first; if a newer column
    // doesn't exist in this env yet, step down. Without this, a failed
    // select returns data=null and profile gets set to null — which cascades
    // to /journal and /profile rendering blank (both gate on
    // profile.username) and breaks first-login routing.
    //
    //   tier 1: bio + onboarded_at  (20260510 + 20260608 applied)
    //   tier 2: bio                 (only 20260510 applied)
    //   tier 3: legacy              (neither applied)
    let onboardedSupported = true;
    let res = await supabase
      .from("profiles")
      .select("id, username, is_seed, is_admin, bio, onboarded_at")
      .eq("id", userId)
      .single();
    if (res.error) {
      onboardedSupported = false;
      res = await supabase
        .from("profiles")
        .select("id, username, is_seed, is_admin, bio")
        .eq("id", userId)
        .single();
    }
    let bioSupported = !res.error;
    if (res.error) {
      res = await supabase
        .from("profiles")
        .select("id, username, is_seed, is_admin")
        .eq("id", userId)
        .single();
    }
    if (res.data) {
      setProfile({
        id: res.data.id,
        username: res.data.username,
        is_seed: res.data.is_seed,
        is_admin: res.data.is_admin,
        bio: bioSupported ? (res.data.bio ?? null) : null,
        onboarded_at: onboardedSupported ? (res.data.onboarded_at ?? null) : null,
      });
    } else {
      setProfile(null);
    }
  }

  async function refreshProfile() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) await loadProfile(session.user.id);
  }

  useEffect(() => {
    // Which user id we've already loaded a profile for. Supabase fires
    // onAuthStateChange on tab-focus session revalidation (TOKEN_REFRESHED /
    // a redundant SIGNED_IN for the SAME user). The old handler swapped in a
    // fresh `user` object and reloaded the profile on every such event, which
    // cascaded into every screen re-bootstrapping (the "come back to the tab
    // and the page flashes / re-fetches everything" bug). We now only react
    // when the signed-in identity actually changes; same-user refreshes are
    // no-ops (keep the same `user` reference, skip the profile reload).
    let loadedForId: string | null = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      const id = session?.user?.id ?? null;
      setUser(session?.user ?? null);
      if (id) { loadedForId = id; loadProfile(id); }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id ?? null;
      // Same user → keep the exact same object reference so nothing downstream
      // re-runs. Only build a new user object on a real identity change.
      setUser((prev) => (prev?.id === id ? prev : (session?.user ?? null)));
      if (!id) { loadedForId = null; setProfile(null); return; }
      if (loadedForId !== id) { loadedForId = id; loadProfile(id); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signUp(email: string, password: string, username: string): Promise<string | null> {
    // Validate username length
    const trimmed = username.trim();
    if (trimmed.length < 3) return "Username must be at least 3 characters";
    if (trimmed.length > 30) return "Username must be 30 characters or less";

    // Check username is not already taken
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .single();
    if (existing) return "An account with that email or username already exists.";

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    if (error) {
      // Return a generic message to prevent email enumeration
      if (
        error.message.toLowerCase().includes("already") ||
        error.message.toLowerCase().includes("exists") ||
        error.message.toLowerCase().includes("registered") ||
        error.message.toLowerCase().includes("duplicate")
      ) {
        return "An account with that email or username already exists.";
      }
      return error.message;
    }
    return null;
  }

  async function signIn(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }

  async function signOut() {
    // Try the normal (global-scope) signOut first — that invalidates the
    // refresh token server-side, which is what we want for security.
    // Swallow any error: when the JWT references a deleted auth.users row
    // (dangling-token case after a beta-prep SQL reset), the server rejects
    // the logout with 401 and supabase-js surfaces it without clearing
    // local state. The user then sees an unresponsive Sign-out button.
    try {
      await supabase.auth.signOut();
    } catch {
      // intentionally empty — fall through to local clear
    }
    // Belt-and-suspenders: local-scope signOut never hits the network and
    // always clears client-side tokens from localStorage, so
    // onAuthStateChange fires with a null session and the UI updates
    // regardless of whether the global logout succeeded.
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // intentionally empty
    }
  }

  return (
    <Ctx.Provider value={{ user, profile, loading, signUp, signIn, signOut, refreshProfile }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
