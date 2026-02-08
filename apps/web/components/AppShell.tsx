"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, role, loading, signOut } = useAuth();

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="app-header" role="banner">
        <Link href="/" className="app-logo" aria-label="NexSupply home">
          NexSupply
        </Link>
        <nav className="app-nav" aria-label="Main navigation">
          <Link href="/">Home</Link>
          {user && <Link href="/upload">Analyze product</Link>}
          {user && role === "admin" && <Link href="/admin">Admin</Link>}
        </nav>
        <div className="app-user">
          {loading ? (
            <span className="text-muted" aria-live="polite">Loading…</span>
          ) : user ? (
            <>
              <span className="text-muted" title={user.email ?? undefined}>
                {user.email}
              </span>
              <button type="button" className="btn btn-ghost" onClick={signOut} aria-label="Sign out">
                Sign out
              </button>
            </>
          ) : null}
        </div>
      </header>
      <main className="app-main" id="main-content">
        {children}
      </main>
      <footer className="app-footer" role="contentinfo">
        <div className="container">
          <p className="footer-text">
            <Link href="/">NexSupply</Link>
            <span className="text-subtle"> — Find 1688 factories with one photo</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
