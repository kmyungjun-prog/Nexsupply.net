"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { get } from "@/lib/api";

type ProjectItem = {
  id: string;
  status: string;
  createdAt: string;
  resolvedViewJsonb: {
    product_name?: string;
    product_name_zh?: string;
  } | null;
};

type ProjectsResponse = {
  projects: ProjectItem[];
};

export default function ProjectsPage() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    getIdToken()
      .then((token) => get<ProjectsResponse>("/projects", token))
      .then((data) => setProjects(data.projects ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [user, getIdToken]);

  useEffect(() => {
    if (!authLoading && !user) {
      window.location.href = "/";
    }
  }, [authLoading, user]);

  if (authLoading || !user) {
    return (
      <div className="container mt-6">
        <div className="skeleton" style={{ height: 32, width: 200, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 20, width: "70%" }} />
      </div>
    );
  }

  return (
    <div className="container">
      <h1 className="mb-4">My analyses</h1>
      <p className="text-muted mb-6">Your past product analyses.</p>

      {loading && (
        <div className="card">
          <p className="text-muted mb-0">Loading…</p>
        </div>
      )}

      {error && (
        <div className="alert alert-error mb-4">{error}</div>
      )}

      {!loading && !error && projects.length === 0 && (
        <div className="card">
          <p className="text-muted mb-0">No analyses yet. Upload a photo to get started.</p>
          <Link href="/upload" className="btn btn-primary mt-4">Analyze product photo</Link>
        </div>
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Product</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>{new Date(p.createdAt).toLocaleString()}</td>
                  <td>
                    {p.resolvedViewJsonb?.product_name ??
                      p.resolvedViewJsonb?.product_name_zh ??
                      "—"}
                  </td>
                  <td>
                    <span className="badge badge-neutral">{p.status}</span>
                  </td>
                  <td>
                    <Link href={`/report/${p.id}`} className="btn btn-ghost btn-sm">
                      View report →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4">
        <Link href="/" className="btn btn-ghost">Back to home</Link>
      </p>
    </div>
  );
}
