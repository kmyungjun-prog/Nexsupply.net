import type { BlueprintReviewResponse } from "../types/blueprint-review";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

function getToken(): string | null {
  return sessionStorage.getItem("internal_review_token") ?? localStorage.getItem("internal_review_token");
}

export async function fetchBlueprintReview(projectId: string): Promise<BlueprintReviewResponse> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/internal/projects/${projectId}/blueprint-review`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

export async function approveExecution(
  projectId: string,
  approvedSteps: string[],
  idempotencyKey: string
): Promise<{ ok: boolean; message: string; replayed?: boolean }> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/internal/projects/${projectId}/approve-execution`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ approved_steps: approvedSteps }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

export async function markSent(
  projectId: string,
  step: string,
  evidenceIds: string[]
): Promise<{ ok: boolean; message: string; step?: string; alreadyRecorded?: boolean }> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/internal/projects/${projectId}/mark-sent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ step, evidence_ids: evidenceIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? res.statusText);
  return data;
}
