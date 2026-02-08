"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { get, post } from "@/lib/api";

type FactoryCandidatePreview = {
  name: string;
  location: string;
  moq?: string;
  price_range?: { min?: number; max?: number; currency?: string };
  url: string;
};

type ProjectReport = {
  id: string;
  status: string;
  ownerUserId: string;
  resolvedViewJsonb: {
    product_name?: string;
    product_name_zh?: string;
    category?: string;
    material?: string;
    estimated_specs?: string;
    search_keywords_1688?: string[];
    factory_candidates?: FactoryCandidatePreview[];
    product_category?: string;
    estimated_margin?: { min?: number; max?: number; unit?: string };
    _source?: string;
    _analyzed_at?: string;
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

  // 분석 중일 때 5초마다 폴링
  useEffect(() => {
    if (!projectId || !project) return;
    const view = project.resolvedViewJsonb;
    const hasGemini = view?._source === "gemini_vision" && (view?.product_name ?? view?.product_name_zh);
    const hasReport =
      hasGemini ||
      view?.product_category != null ||
      view?.category != null ||
      (view?.estimated_margin != null && (view.estimated_margin.min != null || view.estimated_margin.max != null));
    const pending = project.status === "ANALYZING" && !hasReport;
    if (!pending) return;
    const t = setInterval(loadProject, 5000);
    return () => clearInterval(t);
  }, [projectId, project?.status, project?.resolvedViewJsonb]);

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
      const putRes = await fetch(initiate.upload_url, {
        method: "PUT",
        headers,
        body: f,
        duplex: "half",
      } as RequestInit & { duplex: string });
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
  if (loading && !project) {
    return (
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "1rem" }}>
        <div style={{ height: 24, width: "40%", background: "#e5e7eb", borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 16, width: "70%", background: "#f3f4f6", borderRadius: 4, marginBottom: 8 }} />
        <div style={{ height: 16, width: "55%", background: "#f3f4f6", borderRadius: 4, marginBottom: 24 }} />
        <div style={{ height: 120, background: "#f9fafb", borderRadius: 12, marginBottom: 12 }} />
        <div style={{ height: 80, background: "#f9fafb", borderRadius: 12 }} />
        <p style={{ marginTop: "1rem" }}><Link href="/">Back</Link></p>
      </section>
    );
  }
  if (error && !project) return <section><p style={{ color: "red" }}>{error}</p><Link href="/">Back</Link></section>;
  if (!project) return null;

  const view = project.resolvedViewJsonb;
  const category = view?.product_category ?? view?.category ?? null;
  const margin = view?.estimated_margin ?? null;
  const hasGemini = view?._source === "gemini_vision" && (view?.product_name ?? view?.product_name_zh);
  const hasReport =
    hasGemini ||
    category != null ||
    (margin != null && (margin.min != null || margin.max != null));
  const pending = project.status === "ANALYZING" && !hasReport;
  const factoryCandidates = view?.factory_candidates ?? [];

  return (
    <section style={{ maxWidth: 720, margin: "0 auto", padding: "1rem" }}>
      <h2>H-Report</h2>
      <p><strong>Project ID:</strong> {project.id}</p>
      <p><strong>Status:</strong> {project.status}</p>
      {pending ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "1rem" }}>
          <span
            style={{
              width: 24,
              height: 24,
              border: "2px solid #e5e7eb",
              borderTopColor: "#2563eb",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <p style={{ margin: 0 }}>Analyzing… We’ll refresh automatically every 5 seconds.</p>
        </div>
      ) : (
        <>
          {/* 제품 분석 결과 카드 */}
          {(view?.product_name ?? view?.product_name_zh) && (
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "1rem 1.25rem",
                marginTop: "1rem",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
            >
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "1.1rem" }}>제품 분석 결과</h3>
              <p style={{ margin: "0.25rem 0" }}>
                <strong>제품명 (EN):</strong> {view.product_name ?? "—"}
              </p>
              {view.product_name_zh && (
                <p style={{ margin: "0.25rem 0" }}>
                  <strong>제품명 (중국어):</strong> {view.product_name_zh}
                </p>
              )}
              {(view.category ?? view.product_category) && (
                <p style={{ margin: "0.25rem 0" }}>
                  <strong>카테고리:</strong> {view.category ?? view.product_category}
                </p>
              )}
              {view.material && (
                <p style={{ margin: "0.25rem 0" }}>
                  <strong>소재:</strong> {view.material}
                </p>
              )}
              {view.estimated_specs && (
                <p style={{ margin: "0.25rem 0" }}>
                  <strong>추정 스펙:</strong> {view.estimated_specs}
                </p>
              )}
              {view._analyzed_at && (
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem", color: "#6b7280" }}>
                  AI 분석: {new Date(view._analyzed_at).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/* 레거시: category / margin만 있는 경우 */}
          {!hasGemini && (category != null || (margin?.min != null || margin?.max != null)) && (
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

          {/* 공장 후보 카드 (최대 3개 무료) */}
          {factoryCandidates.length > 0 && (
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "1rem 1.25rem",
                marginTop: "1rem",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
            >
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "1.1rem" }}>공장 후보 (무료 미리보기)</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {factoryCandidates.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid #f3f4f6",
                      borderRadius: 8,
                      padding: "0.75rem 1rem",
                      background: "#fafafa",
                    }}
                  >
                    <p style={{ margin: "0 0 0.25rem", fontWeight: 600 }}>{c.name}</p>
                    <p style={{ margin: "0.25rem 0", fontSize: "0.9rem" }}>
                      위치: {c.location} · MOQ: {c.moq ?? "—"}
                    </p>
                    {c.price_range && (c.price_range.min != null || c.price_range.max != null) && (
                      <p style={{ margin: "0.25rem 0", fontSize: "0.9rem" }}>
                        가격: {c.price_range.min ?? "?"}–{c.price_range.max ?? "?"}{" "}
                        {c.price_range.currency ?? "CNY"}
                      </p>
                    )}
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: "0.875rem", color: "#2563eb" }}
                    >
                      1688에서 보기 →
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 업그레이드 CTA */}
          <div
            style={{
              background: "#fef3c7",
              padding: "1rem",
              borderRadius: 8,
              marginTop: "1rem",
              border: "1px solid #fcd34d",
            }}
          >
            <p style={{ margin: 0 }}>
              위 결과는 AI 추정 가설이며, 실제 공장 가격이 아닙니다.
            </p>
          </div>
          <p style={{ marginTop: "1rem" }}>
            <Link href={`/blueprint-request/${projectId}`}>
              <button type="button">
                더 많은 공장 후보 + AI 비교 분석 받기 → Blueprint ($49)
              </button>
            </Link>
          </p>
        </>
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
