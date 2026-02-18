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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runWithFile = async (file: File) => {
    if (!user || loading) return;
    const mime = file.type || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)) {
      setError("Only JPEG, PNG, GIF, and WebP are supported.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("File size must be 25 MB or less.");
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setError(null);
  };

  const handleAnalyze = () => {
    const file = selectedFile || fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Please select an image.");
      return;
    }
    runWithFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
    }
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
          <p className="text-muted">Please sign in to analyze a product.</p>
          <Link href="/" className="btn btn-secondary mt-4">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 className="mb-2">Analyze product photo</h1>
      <p className="text-muted mb-6">Upload a photo and AI will analyze it and recommend 1688 factory candidates.</p>

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
          aria-label="Drag and drop an image or click to select"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            aria-label="Select product image"
            disabled={!!loading}
            onChange={handleFileChange}
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
          ) : selectedFile ? (
            <div style={{ textAlign: "center" }}>
              <img
                src={URL.createObjectURL(selectedFile)}
                alt="Preview"
                style={{ maxHeight: 120, maxWidth: "100%", borderRadius: 8, marginBottom: 8, objectFit: "contain" }}
              />
              <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem" }}>{selectedFile.name}</p>
              <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#666" }}>
                {(selectedFile.size / 1024 / 1024).toFixed(1)} MB — Click to change
              </p>
            </div>
          ) : (
            <p className="upload-zone-text">Drag and drop an image here, or click to choose</p>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <button type="button" className="btn btn-primary" onClick={handleAnalyze} disabled={loading}>
            {loading ? "Processing…" : "Analyze"}
          </button>
          <Link href="/" className="btn btn-secondary">
            Cancel
          </Link>
        </div>

        {error && (
          <div className="alert alert-error mt-4">
            <p className="mb-2">{error}</p>
            {(error === "Internal server error" || error === "Internal Server Error") && (
              <div className="text-muted mb-2" style={{ fontSize: "0.875rem" }}>
                <p className="mb-1">To find the cause:</p>
                <ul style={{ margin: "0 0 0 1rem", paddingLeft: "0.5rem" }}>
                  <li>Open <strong>Google Cloud Console → Cloud Run → nexsupply-backend → Logs</strong>. Look for the error when you click Analyze.</li>
                  <li>Typical causes: <strong>GCS</strong> — bucket <code>nexsupply-storage</code> must exist and the Cloud Run service account needs Storage Object Admin; <strong>DB</strong> — Cloud SQL must allow connections from Cloud Run (authorized networks or Connector).</li>
                </ul>
              </div>
            )}
            <button type="button" className="btn btn-ghost mt-2" onClick={() => { setError(null); setStepIndex(0); }}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
