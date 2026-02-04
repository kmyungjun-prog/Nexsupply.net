"use client";

/**
 * Auth: signInWithGoogle, signOut, getIdToken, getUserRole.
 * Role from getIdTokenResult() custom claim; default "user".
 */

import React, { createContext, useContext, useEffect, useState } from "react";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

export type Role = "user" | "admin";

function coerceRole(role: unknown): Role {
  if (role === "user" || role === "admin") return role;
  return "user";
}

type AuthState = {
  user: User | null;
  role: Role;
  loading: boolean;
};

type AuthContextValue = AuthState & {
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  getUserRole: () => Role;
};

const defaultState: AuthState = { user: null, role: "user", loading: true };

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(defaultState);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ user: null, role: "user", loading: false });
        return;
      }
      try {
        const result = await user.getIdTokenResult();
        const role = coerceRole(result.claims?.role);
        setState({ user, role, loading: false });
      } catch {
        setState({ user, role: "user", loading: false });
      }
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = async () => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    await signInWithPopup(auth, new GoogleAuthProvider());
  };

  const handleSignOut = async () => {
    const auth = getFirebaseAuth();
    if (auth) await signOut(auth);
    setState({ user: null, role: "user", loading: false });
  };

  const getIdToken = async (): Promise<string | null> => {
    const auth = getFirebaseAuth();
    if (!state.user || !auth) return null;
    return state.user.getIdToken();
  };

  const getUserRole = (): Role => state.role;

  const value: AuthContextValue = {
    ...state,
    signInWithGoogle,
    signOut: handleSignOut,
    getIdToken,
    getUserRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
