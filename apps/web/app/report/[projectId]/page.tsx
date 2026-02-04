"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { get, post } from "@/lib/api";

type ProjectReport = {
  id: string;
  status: string;
  ownerUserId: string;
  resolvedViewJsonb: {
    product_category?: string;
    estimated_margin?: { min?: number; max?: number; unit?: string };
  } | null;
  resolvedViewUpdatedAt: string | null;
  createdAt: string;
};

type EvidenceItem = {
  evidence_id: string;
  original_filename: string | null;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  virus_scan_status?: string;
};

const ACCEPT_EVIDENCE = "application/pdf,image/jpeg,image/png,image/gif,image/webp";

export default function ReportPage() {
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  const { getIdToken } = useAuth();
  const [project, setProject] = useState<ProjectReport | null>(null);
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadProject = () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    getIdToken()
      .then((token) => get<ProjectReport>(`/projects/${projectId}`, token))
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const loadEvidence = () => {
    if (!projectId) return;
    getIdToken()
      .then((token) => get<EvidenceItem[]>(`/projects/${projectId}/evidence`, token))
      .then(setEvidenceList)
      .catch(() => setEvidenceList([]));
  };

  const load = () => {
    loadProject();
    loadEvidence();
  };

  useEffect(() => {
    if (projectId) {
      loadProject();
      loadEvidence();
    }
  }, [projectId]);

  const handleEvidenceUpload = async (file?: File | null) => {
    const f = file ?? fileInputRef.current?.files?.[0];
    if (!projectId || !f || uploadStatus) return;
    const mime = f.type || "application/octet-stream";
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowed.includes(mime)) {
      setError("Allowed: PDF, JPEG, PNG, GIF, WebP.");
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError("File too large (max 25 MB).");
      return;
    }
    setUploadStatus("Preparing…");
    setError(null);
    try {
      const token = await getIdToken();
      const initiate = await post<{ upload_url: string; upload_headers?: Record<string, string>; gcs_path: string }>(
        `/projects/${projectId}/evidence/initiate`,
        { original_filename: f.name, mime_type: mime, size_bytes: f.size },
        token
      );
      setUploadStatus("Uploading…");
      const headers: Record<string, string> = { "Content-Type": mime, ...(initiate.upload_headers ?? {}) };
      const putRes = await fetch(initiate.upload_url, { method: "PUT", headers, body: f });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      setUploadStatus("Registering…");
      const idempotencyKey = `evidence-complete:${projectId}:${initiate.gcs_path}`;
      await post(
        `/projects/${projectId}/evidence/complete`,
        {
          gcs_path: initiate.gcs_path,
          original_filename: f.name,
          mime_type: mime,
          size_bytes: f.size,
        },
        token,
        idempotencyKey
      );
      setUploadStatus(null);
      loadEvidence();
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUploadStatus(null);
    }
  };

  const onEvidenceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleEvidenceUpload(file);
  };

  if (!projectId) return null;
  if (loading && !project) return <section><p>Loading…</p><Link href="/">Back</Link></section>;
  if (error && !project) return <section><p style={{ color: "red" }}>{error}</p><Link href="/">Back</Link></section>;
  if (!project) return null;

  const category = project.resolvedViewJsonb?.product_category ?? null;
  const margin = project.resolvedViewJsonb?.estimated_margin ?? null;
  const hasReport = category != null || (margin != null && (margin.min != null || margin.max != null));
  const pending = project.status === "ANALYZING" && !hasReport;

  return (
    <section>
      <h2>H-Report</h2>
      <p><strong>Project ID:</strong> {project.id}</p>
      <p><strong>Status:</strong> {project.status}</p>
      {pending ? (
        <p>Analysis in progress. Click Refresh to check again.</p>
      ) : (
        <>
          <p><strong>Product category:</strong> {category ?? "—"}</p>
          <p>
            <strong>Estimated margin:</strong>{" "}
            {margin?.min != null && margin?.max != null
              ? `${margin.min}–${margin.max}%`
              : margin?.min != null
                ? `${margin.min}%`
                : margin?.max != null
                  ? `up to ${margin.max}%`
                  : "—"}
          </p>
        </>
      )}
      <div style={{ background: "#fef3c7", padding: "1rem", borderRadius: 8, marginTop: "1rem" }}>
        <p style={{ margin: 0 }}>
          This is an AI-estimated hypothesis, not live factory pricing.
        </p>
      </div>
      {!pending && (
        <p style={{ marginTop: "1rem" }}>
          <Link href={`/blueprint-request/${projectId}`}>
            <button type="button">Request Blueprint ($49)</button>
          </Link>
        </p>
      )}
      <p style={{ marginTop: "0.5rem" }}>
        <button type="button" onClick={load} disabled={loading}>Refresh</button>
      </p>

      <section style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid #eee" }}>
        <h3>Evidence documents</h3>
        <p>Upload PDF or images. No edit or delete.</p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_EVIDENCE}
          onChange={onEvidenceFileChange}
          disabled={!!uploadStatus}
          aria-label="Upload evidence (PDF or image)"
        />
        {uploadStatus && <p style={{ margin: "4px 0", color: "#6b7280" }}>{uploadStatus}</p>}
        <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #ddd" }}>
              <th style={{ textAlign: "left", padding: 6 }}>Filename</th>
              <th style={{ textAlign: "left", padding: 6 }}>MIME type</th>
              <th style={{ textAlign: "left", padding: 6 }}>Created</th>
              <th style={{ textAlign: "left", padding: 6 }}>Virus scan</th>
            </tr>
          </thead>
          <tbody>
            {evidenceList.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 8, color: "#6b7280" }}>No evidence yet.</td></tr>
            )}
            {evidenceList.map((ev) => (
              <tr key={ev.evidence_id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 6 }}>{ev.original_filename ?? "—"}</td>
                <td style={{ padding: 6 }}>{ev.mime_type}</td>
                <td style={{ padding: 6 }}>{new Date(ev.created_at).toLocaleString()}</td>
                <td style={{ padding: 6 }}>{ev.virus_scan_status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p><Link href="/">Back</Link></p>
    </section>
  );
}
