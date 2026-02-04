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
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [getIdToken]);

  return (
    <AdminGuard>
      <section>
        <h2>Admin — Projects</h2>
        {loading && <p>Loading…</p>}
        {error && <p style={{ color: "red" }}>{error}</p>}
        {!loading && !error && (
          <>
            <table>
              <thead>
                <tr>
                  <th>Project ID</th>
                  <th>Status</th>
                  <th>Created at</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/admin/projects/${p.id}`}>{p.id}</Link></td>
                    <td>{p.status}</td>
                    <td>{p.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {projects.length === 0 && <p>No projects.</p>}
          </>
        )}
        <p style={{ marginTop: "1rem" }}><Link href="/">Home</Link></p>
      </section>
    </AdminGuard>
  );
}
