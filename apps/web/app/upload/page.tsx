"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { post } from "@/lib/api";

type InitiateRes = {
  project_id: string;
  upload_url: string;
  upload_headers: Record<string, string>;
  gcs_path: string;
  upload_expires_at: string;
};

const STEPS = ["준비 중", "업로드 중", "분석 중", "완료"] as const;

export default function UploadPage() {
  const { user, getIdToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runWithFile = async (file: File) => {
    if (!user || loading) return;
    const mime = file.type || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)) {
      setError("JPEG, PNG, GIF, WebP만 지원합니다.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("파일 크기는 25MB 이하여야 합니다.");
      return;
    }
    setLoading(true);
    setStepIndex(0);
    setError(null);
    try {
      const token = await getIdToken();
      setStepIndex(1);
      const initiate = await post<InitiateRes>(
        "/projects/initiate-photo",
        { mime_type: mime, size_bytes: file.size },
        token
      );
      setStepIndex(2);
      const headers: Record<string, string> = {
        "Content-Type": mime,
        ...(initiate.upload_headers ?? {}),
      };
      const putRes = await fetch(initiate.upload_url, {
        method: "PUT",
        headers,
        body: file,
        duplex: "half",
      } as RequestInit & { duplex: string });
      if (!putRes.ok) throw new Error(`업로드 실패: ${putRes.status}`);
      setStepIndex(3);
      const idempotencyKey = `photo-complete:${initiate.project_id}:${initiate.gcs_path}`;
      await post(
        `/projects/${initiate.project_id}/photo/complete`,
        {
          gcs_path: initiate.gcs_path,
          mime_type: mime,
          size_bytes: file.size,
          original_filename: file.name,
        },
        token,
        idempotencyKey
      );
      router.push(`/report/${initiate.project_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStepIndex(0);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("이미지를 선택해 주세요.");
      return;
    }
    runWithFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) runWithFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  if (!user) {
    return (
      <div className="container">
        <div className="card">
          <p className="text-muted">제품 분석을 하려면 로그인해 주세요.</p>
          <Link href="/" className="btn btn-secondary mt-4">
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 className="mb-2">제품 사진 분석</h1>
      <p className="text-muted mb-6">사진을 올리면 AI가 제품을 분석하고 1688 공장 후보를 추천합니다.</p>

      <div className="card mb-4">
        <div
          className={`upload-zone ${dragOver ? "drag-over" : ""} ${loading ? "disabled" : ""}`}
          role="button"
          tabIndex={0}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          aria-label="이미지 드래그 또는 클릭하여 선택"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            aria-label="제품 이미지 선택"
            disabled={!!loading}
            style={{ display: "none" }}
          />
          {loading ? (
            <>
              <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>{STEPS[stepIndex]}…</p>
              <div className="flex gap-2 items-center" style={{ justifyContent: "center", marginTop: 8 }}>
                {STEPS.map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: i <= stepIndex ? "var(--color-primary)" : "var(--color-border)",
                    }}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="upload-zone-text">이미지를 여기에 끌어다 놓거나 클릭하여 선택</p>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <button type="button" className="btn btn-primary" onClick={handleAnalyze} disabled={loading}>
            {loading ? "처리 중…" : "분석 시작"}
          </button>
          <Link href="/" className="btn btn-secondary">
            취소
          </Link>
        </div>

        {error && (
          <div className="alert alert-error mt-4">
            {error}
            <button type="button" className="btn btn-ghost mt-2" onClick={() => { setError(null); setStepIndex(0); }}>
              다시 시도
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
