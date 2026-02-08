"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, role, loading, signOut } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link href="/" className="app-logo">
          NexSupply
        </Link>
        <nav className="app-nav">
          <Link href="/">홈</Link>
          {user && <Link href="/upload">제품 분석</Link>}
          {user && role === "admin" && <Link href="/admin">관리자</Link>}
        </nav>
        <div className="app-user">
          {loading ? (
            <span className="text-muted">로딩 중…</span>
          ) : user ? (
            <>
              <span className="text-muted">{user.email}</span>
              <button type="button" className="btn btn-ghost" onClick={signOut}>
                로그아웃
              </button>
            </>
          ) : null}
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
