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
          <h1 style={{ marginBottom: "0.5rem" }}>사진 한 장으로 1688 공장 찾기</h1>
          <p className="text-muted mb-4" style={{ marginBottom: "1.5rem" }}>
            제품 사진을 올리면 AI가 분석하고, 맞춤 1688 공장 후보를 추천해 드립니다.
          </p>
          <button type="button" className="btn btn-primary" onClick={signInWithGoogle} style={{ padding: "0.75rem 1.5rem" }}>
            Google로 로그인
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 className="mb-4">대시보드</h1>
      <p className="text-muted mb-6">로그인: {user.email}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Link href="/upload" style={{ textDecoration: "none" }}>
          <div className="card card-link">
            <h3 style={{ marginBottom: "0.25rem" }}>제품 사진 분석</h3>
            <p className="text-muted" style={{ margin: 0, fontSize: "0.9375rem" }}>
              사진을 업로드하면 AI가 제품을 분석하고 1688 공장 후보를 추천합니다.
            </p>
          </div>
        </Link>
        {role === "admin" && (
          <Link href="/admin" style={{ textDecoration: "none" }}>
            <div className="card card-link">
              <h3 style={{ marginBottom: "0.25rem" }}>관리자</h3>
              <p className="text-muted" style={{ margin: 0, fontSize: "0.9375rem" }}>
                프로젝트·클레임 관리
              </p>
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}
