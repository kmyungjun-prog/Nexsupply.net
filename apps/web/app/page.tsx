"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const { user, role, loading, signInWithGoogle } = useAuth();

  if (loading) {
    return (
      <div className="container mt-6">
        <div className="skeleton" style={{ height: 32, width: 200, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 20, width: "70%" }} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container" style={{ paddingTop: "3rem" }}>
        <div className="card" style={{ textAlign: "center", padding: "2.5rem 2rem" }}>
          <h1 style={{ marginBottom: "0.5rem" }}>Find 1688 factories with one photo</h1>
          <p className="text-muted mb-4" style={{ marginBottom: "1.5rem" }}>
            Upload a product photo and AI will analyze it and recommend 1688 factory candidates.
          </p>
          <button type="button" className="btn btn-primary" onClick={signInWithGoogle} style={{ padding: "0.75rem 1.5rem" }}>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 className="mb-4">Dashboard</h1>
      <p className="text-muted mb-6">Signed in as {user.email}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Link href="/upload" style={{ textDecoration: "none" }}>
          <div className="card card-link">
            <h3 style={{ marginBottom: "0.25rem" }}>Analyze product photo</h3>
            <p className="text-muted" style={{ margin: 0, fontSize: "0.9375rem" }}>
              Upload a photo and get AI analysis plus 1688 factory recommendations.
            </p>
          </div>
        </Link>
        {role === "admin" && (
          <Link href="/admin" style={{ textDecoration: "none" }}>
            <div className="card card-link">
              <h3 style={{ marginBottom: "0.25rem" }}>Admin</h3>
              <p className="text-muted" style={{ margin: 0, fontSize: "0.9375rem" }}>
                Manage projects and claims
              </p>
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}
