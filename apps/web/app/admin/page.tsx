"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminGuard from "@/components/AdminGuard";
import { useAuth } from "@/lib/auth";
import { get } from "@/lib/api";

type Project = { id: string; status: string; createdAt: string };

export default function AdminPage() {
  const { getIdToken } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getIdToken()
      .then((token) => get<{ projects: Project[] }>("/projects", token))
      .then((r) => {
        if (!cancelled) setProjects(r.projects ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [getIdToken]);

  return (
    <AdminGuard>
      <div className="container-wide">
        <h1 className="mb-2">Admin — Projects</h1>
        <p className="text-muted mb-6">List of all projects.</p>

        {loading && (
          <div className="card">
            <div className="flex items-center gap-3">
              <span className="spinner" />
              <span className="text-muted">Loading…</span>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="alert alert-error mb-4">{error}</div>
        )}

        {!loading && !error && (
          <div className="card">
            {projects.length === 0 ? (
              <p className="text-muted mb-0">No projects yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Project ID</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/admin/projects/${p.id}`}>{p.id}</Link>
                        </td>
                        <td>{p.status}</td>
                        <td>{new Date(p.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <p className="mt-6">
          <Link href="/" className="btn btn-secondary">Back to home</Link>
        </p>
      </div>
    </AdminGuard>
  );
}
