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

export default function UploadPage() {
  const { user, getIdToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAnalyze = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!user || loading || !file) {
      if (!file) setError("Select an image first.");
      return;
    }
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
    setStatus("Preparing…");
    setError(null);
    try {
      const token = await getIdToken();
      const initiate = await post<InitiateRes>(
        "/projects/initiate-photo",
        { mime_type: mime, size_bytes: file.size },
        token
      );
      setStatus("Uploading…");
      const headers: Record<string, string> = {
        "Content-Type": mime,
        ...(initiate.upload_headers ?? {}),
      };
      const putRes = await fetch(initiate.upload_url, {
        method: "PUT",
        headers,
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed: ${putRes.status}`);
      }
      setStatus("Analyzing…");
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
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <section>
        <p>Please sign in to analyze a product.</p>
        <Link href="/">Home</Link>
      </section>
    );
  }

  return (
    <section>
      <h2>Analyze product</h2>
      <p>Upload a product photo. We will create a project and run analysis.</p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        aria-label="Select product image"
        disabled={!!loading}
      />
      <button type="button" onClick={handleAnalyze} disabled={loading}>
        {loading ? (status ?? "Analyzing…") : "Analyze product"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <p style={{ marginTop: "1rem" }}><Link href="/">Back</Link></p>
    </section>
  );
}
