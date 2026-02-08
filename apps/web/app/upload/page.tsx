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

const STEPS = ["Preparing", "Uploading", "Analyzing", "Done"] as const;

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
      setError("Allowed formats: JPEG, PNG, GIF, WebP.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("File too large (max 25 MB).");
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
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
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
      setError("Select an image first.");
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
      <section>
        <p>Please sign in to analyze a product.</p>
        <Link href="/">Home</Link>
      </section>
    );
  }

  return (
    <section style={{ maxWidth: 480, margin: "0 auto", padding: "1.5rem" }}>
      <h2>Analyze product</h2>
      <p>Upload a product photo. We will create a project and run AI analysis.</p>

      <div
        role="button"
        tabIndex={0}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#2563eb" : "#d1d5db"}`,
          borderRadius: 12,
          padding: "2rem",
          textAlign: "center",
          background: dragOver ? "#eff6ff" : "#f9fafb",
          cursor: loading ? "not-allowed" : "pointer",
          marginBottom: "1rem",
        }}
        aria-label="Drop image or click to select"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          aria-label="Select product image"
          disabled={!!loading}
          style={{ display: "none" }}
        />
        {loading ? (
          <>
            <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
              {STEPS[stepIndex]}…
            </p>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 8 }}>
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: i <= stepIndex ? "#2563eb" : "#e5e7eb",
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <p style={{ margin: 0, color: "#6b7280" }}>
            Drag & drop an image here, or click to choose
          </p>
        )}
      </div>

      <button type="button" onClick={handleAnalyze} disabled={loading} style={{ marginRight: 8 }}>
        {loading ? "Processing…" : "Analyze product"}
      </button>
      {error && (
        <>
          <p style={{ color: "#dc2626", margin: "0.5rem 0" }}>{error}</p>
          <button type="button" onClick={() => { setError(null); setStepIndex(0); }} style={{ marginTop: 4 }}>
            Try again
          </button>
        </>
      )}
      <p style={{ marginTop: "1rem" }}><Link href="/">Back</Link></p>
    </section>
  );
}
