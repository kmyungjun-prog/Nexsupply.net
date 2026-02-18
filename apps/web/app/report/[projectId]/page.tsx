"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { get } from "@/lib/api";

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

export default function ReportPage() {
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  const { getIdToken } = useAuth();
  const [project, setProject] = useState<ProjectReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (projectId) loadProject();
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !project) return;
    const view = project.resolvedViewJsonb;
    const hasGemini = view?._source === "gemini_vision" && (view?.product_name ?? view?.product_name_zh);
    const hasReport =
      hasGemini ||
      view?.product_category != null ||
      view?.category != null ||
      (view?.estimated_margin != null && (view.estimated_margin.min != null || view.estimated_margin.max != null));
    const factoryCandidates = view?.factory_candidates ?? [];
    const pending =
      (project.status === "ANALYZING" && !hasReport) ||
      (project.status === "BLUEPRINT_RUNNING" && factoryCandidates.length === 0);
    if (!pending) return;
    const t = setInterval(loadProject, 5000);
    return () => clearInterval(t);
  }, [projectId, project?.status, project?.resolvedViewJsonb]);

  if (!projectId) return null;

  if (loading && !project) {
    return (
      <div className="container-wide">
        <div className="skeleton mb-4" style={{ height: 28, width: "40%" }} />
        <div className="skeleton mb-2" style={{ height: 18, width: "70%" }} />
        <div className="skeleton mb-6" style={{ height: 18, width: "55%" }} />
        <div className="skeleton mb-4" style={{ height: 140, borderRadius: "var(--radius-lg)" }} />
        <div className="skeleton" style={{ height: 100, borderRadius: "var(--radius-lg)" }} />
        <p className="mt-4"><Link href="/" className="btn btn-ghost">Back to home</Link></p>
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="container">
        <div className="card">
          <div className="alert alert-error">{error}</div>
          <Link href="/" className="btn btn-secondary mt-4">Back to home</Link>
        </div>
      </div>
    );
  }

  if (!project) return null;

  const view = project.resolvedViewJsonb;
  const category = view?.product_category ?? view?.category ?? null;
  const margin = view?.estimated_margin ?? null;
  const hasGemini = view?._source === "gemini_vision" && (view?.product_name ?? view?.product_name_zh);
  const hasReport =
    hasGemini ||
    category != null ||
    (margin != null && (margin.min != null || margin.max != null));
  const factoryCandidates = view?.factory_candidates ?? [];
  const pending =
    (project.status === "ANALYZING" && !hasReport) ||
    (project.status === "BLUEPRINT_RUNNING" && factoryCandidates.length === 0);

  return (
    <div className="container-wide">
      <div className="flex items-center gap-4 mb-6">
        <h1 className="mb-0">Analysis report</h1>
        <span className={`badge ${pending ? "badge-warning" : "badge-neutral"}`}>{project.status}</span>
      </div>
      <p className="text-muted mb-6">Project ID: {project.id}</p>

      {pending ? (
        <div className="card">
          <div className="flex items-center gap-3">
            <span className="spinner" />
            <p className="mb-0 text-muted">
              {project.status === "BLUEPRINT_RUNNING" ? "Getting detailed analysis…" : "Analyzing…"} This page will refresh automatically every 5 seconds.
            </p>
          </div>
        </div>
      ) : (
        <>
          {(view?.product_name ?? view?.product_name_zh) && (
            <div className="card mb-4">
              <h3 className="card-title">Product analysis</h3>
              <p className="mb-2"><strong>Product name (EN)</strong> {view.product_name ?? "—"}</p>
              {view.product_name_zh && <p className="mb-2"><strong>Product name (Chinese)</strong> {view.product_name_zh}</p>}
              {(view.category ?? view.product_category) && (
                <p className="mb-2"><strong>Category</strong> {view.category ?? view.product_category}</p>
              )}
              {view.material && <p className="mb-2"><strong>Material</strong> {view.material}</p>}
              {view.estimated_specs && <p className="mb-2"><strong>Estimated specs</strong> {view.estimated_specs}</p>}
              {view._analyzed_at && (
                <p className="text-subtle mb-0">AI analyzed at: {new Date(view._analyzed_at).toLocaleString()}</p>
              )}
            </div>
          )}

          {!hasGemini && (category != null || (margin?.min != null || margin?.max != null)) && (
            <div className="card mb-4">
              <p><strong>Product category</strong> {category ?? "—"}</p>
              <p className="mb-0">
                <strong>Estimated margin</strong>{" "}
                {margin?.min != null && margin?.max != null
                  ? `${margin.min}–${margin.max}%`
                  : margin?.min != null
                    ? `${margin.min}%`
                    : margin?.max != null
                      ? `up to ${margin.max}%`
                      : "—"}
              </p>
            </div>
          )}

          {factoryCandidates.length > 0 && (
            <div className="card mb-4">
              <h3 className="card-title">Factory candidates (free preview)</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {factoryCandidates.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "0.75rem 1rem",
                      background: "var(--color-border-muted)",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <p className="mb-2" style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{c.name}</p>
                    <p className="text-muted mb-2" style={{ marginBottom: "0.25rem", fontSize: "0.9375rem" }}>
                      Location {c.location} · MOQ {c.moq ?? "—"}
                    </p>
                    {c.price_range && (c.price_range.min != null || c.price_range.max != null) && (
                      <p className="text-muted mb-2" style={{ fontSize: "0.9375rem" }}>
                        Price {c.price_range.min ?? "?"}–{c.price_range.max ?? "?"} {c.price_range.currency ?? "CNY"}
                      </p>
                    )}
                    <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem" }}>
                      View on 1688 →
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="alert alert-warning mb-4">
            Results are AI estimates only, not live factory pricing.
          </div>

          <div className="card mb-4" style={{ textAlign: "center", padding: "1.5rem" }}>
            <p className="mb-2" style={{ fontWeight: 600 }}>Want help sourcing this product?</p>
            <a href="mailto:outreach@nexsupply.net" className="btn btn-accent">Contact us →</a>
          </div>

          <div className="flex gap-2 mb-6">
            <button type="button" className="btn btn-secondary" onClick={loadProject} disabled={loading}>
              Refresh
            </button>
          </div>
        </>
      )}

      <p className="mt-4"><Link href="/" className="btn btn-ghost">Back to home</Link></p>
    </div>
  );
}
