"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const { user, role, loading, signInWithGoogle, signOut } = useAuth();

  if (loading) return <div style={{ padding: "1rem" }}>Loading…</div>;

  return (
    <section>
      <h1>NexSupply</h1>
      {user ? (
        <>
          <p>Signed in as {user.email}. Role: {role}.</p>
          <button type="button" onClick={signOut}>Sign out</button>
          <nav style={{ marginTop: "1rem" }}>
            <p><Link href="/upload">Upload product photo</Link></p>
            {role === "admin" && <p><Link href="/admin">Admin dashboard</Link></p>}
          </nav>
        </>
      ) : (
        <button type="button" onClick={signInWithGoogle}>Sign in with Google</button>
      )}
    </section>
  );
}
