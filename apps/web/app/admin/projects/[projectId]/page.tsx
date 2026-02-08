"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import AdminGuard from "@/components/AdminGuard";
import { useAuth } from "@/lib/auth";
import { get, post } from "@/lib/api";

type AutomationEligibilityValue = {
  eligible?: boolean;
  reasons?: string[];
  blocked_by?: string[];
  evaluated_at?: string;
};

type BlueprintReviewResponse = {
  project: { id: string; status: string };
  hasExecutionApproved: boolean;
  claims: {
    factory_candidate: { id: string; valueJson: unknown }[];
    factory_rule_flags: { id: string; valueJson: unknown }[];
    factory_ai_explanation: { id: string; valueJson: unknown }[];
    execution_plan: { valueJson: unknown }[];
    execution_cost_preview: unknown[];
    execution_action: { id: string; valueJson: unknown }[];
    execution_action_result: { valueJson: unknown }[];
    automation_eligibility?: { id: string; valueJson: unknown }[];
  };
};

type EvidenceItem = {
  evidence_id: string;
  original_filename: string | null;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  uploaded_by: string;
  virus_scan_status?: string;
  /** When backend list includes short-lived download_url, use it directly */
  download_url?: string;
};

const IRREVERSIBLE_WARNING = "This action cannot be undone.";
const ACCEPT_EVIDENCE = "application/pdf,image/*";

export default function AdminProjectPage() {
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  if (!projectId) return null;
  const { getIdToken } = useAuth();
  const [data, setData] = useState<BlueprintReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [selectedSteps, setSelectedSteps] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [selectedEvidenceByStep, setSelectedEvidenceByStep] = useState<Record<string, Set<string>>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const loadEvidence = () => {
    if (!projectId) return;
    setOpenError(null);
    getIdToken()
      .then((token) => get<EvidenceItem[]>(`/internal/projects/${projectId}/evidence`, token))
      .then(setEvidenceList)
      .catch(() => setEvidenceList([]));
  };

  const load = () => {
    setLoading(true);
    setError(null);
    getIdToken()
      .then((token) => get<BlueprintReviewResponse>(`/internal/projects/${projectId}/blueprint-review`, token))
      .then((d) => {
        setData(d);
        loadEvidence();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!projectId) return;
    load();
  }, [projectId]);

  const hasExecutionApproved = data?.hasExecutionApproved ?? false;
  const planSteps = (data?.claims?.execution_plan?.[0]?.valueJson as { steps?: { step: string; description?: string }[] })?.steps ?? [];
  const approvedStepsSet = new Set<string>();
  (data?.claims?.execution_action ?? []).forEach((c) => {
    const step = (c.valueJson as { step?: string })?.step;
    if (step) approvedStepsSet.add(step);
  });
  const sentStepsSet = new Set(
    (data?.claims?.execution_action_result ?? []).map((c) => (c.valueJson as { step?: string })?.step).filter(Boolean) as string[]
  );

  const handleApprove = async () => {
    if (!projectId || selectedSteps.size === 0 || approving) return;
    setApproving(true);
    setError(null);
    setInfo(null);
    try {
      const token = await getIdToken();
      const res = await post<{ ok: boolean; message: string; replayed?: boolean }>(
        `/internal/projects/${projectId}/approve-execution`,
        { approved_steps: Array.from(selectedSteps) },
        token,
        `approve:${projectId}`
      );
      if (res.replayed) setInfo("Already approved.");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!projectId || uploadStatus !== null) return;
    setUploadStatus("Preparing…");
    setError(null);
    try {
      const token = await getIdToken();
      const initiateRes = await post<{
        upload_url: string;
        upload_headers?: Record<string, string>;
        gcs_path: string;
        upload_expires_at: string;
      }>(
        `/internal/projects/${projectId}/evidence/initiate`,
        { original_filename: file.name, mime_type: file.type || "application/octet-stream" },
        token
      );
      setUploadStatus("Uploading…");
      const headers: Record<string, string> = {
        "Content-Type": file.type || "application/octet-stream",
        ...(initiateRes.upload_headers ?? {}),
      };
      const putRes = await fetch(initiateRes.upload_url, {
        method: "PUT",
        headers,
        body: file,
        duplex: "half",
      } as RequestInit & { duplex: string });
      if (!putRes.ok) {
        throw new Error(`Upload failed: ${putRes.status}`);
      }
      setUploadStatus("Registering…");
      const completeIdempotencyKey = `evidence-complete:${projectId}:${initiateRes.gcs_path}`;
      const completeRes = await post<{ evidence_id: string; gcs_path: string }>(
        `/internal/projects/${projectId}/evidence/complete`,
        {
          gcs_path: initiateRes.gcs_path,
          original_filename: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
        },
        token,
        completeIdempotencyKey
      );
      setUploadStatus(null);
      loadEvidence();
      load();
      // Auto-fill new evidence id into first unsent step (SOW: evidence id auto-fill after upload)
      const steps = (data?.claims?.execution_plan?.[0]?.valueJson as { steps?: { step: string }[] })?.steps ?? [];
      const sentSet = new Set(
        (data?.claims?.execution_action_result ?? []).map((c) => (c.valueJson as { step?: string })?.step).filter(Boolean) as string[]
      );
      const firstUnsentStep = steps.find((s) => !sentSet.has(s.step))?.step;
      if (firstUnsentStep && completeRes.evidence_id) {
        setSelectedEvidenceByStep((prev) => {
          const current = new Set(prev[firstUnsentStep] ?? []);
          current.add(completeRes.evidence_id);
          return { ...prev, [firstUnsentStep]: current };
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUploadStatus(null);
    }
  };

  const handleMarkSent = async (step: string) => {
    if (!projectId || sending) return;
    const ids = Array.from(selectedEvidenceByStep[step] ?? []);
    if (ids.length === 0) {
      setError("Select at least one evidence for this step.");
      return;
    }
    setSending(step);
    setError(null);
    setInfo(null);
    try {
      const token = await getIdToken();
      const idempotencyKey = `mark-sent:${projectId}:${step}:${Date.now()}`;
      const res = await post<{ ok: boolean; message: string; alreadyRecorded?: boolean }>(
        `/internal/projects/${projectId}/mark-sent`,
        { step, evidence_ids: ids },
        token,
        idempotencyKey
      );
      if (res.alreadyRecorded) setInfo("Already recorded.");
      else {
        setInfo("Marked sent. Running Phase-H eligibility…");
        try {
          const phaseHKey = `run-phase-h:${projectId}:${new Date().toISOString().slice(0, 10)}`;
          await post<{ ok: boolean; eligible?: boolean }>(
            `/internal/projects/${projectId}/run-phase-h`,
            {},
            token,
            phaseHKey
          );
        } catch {
          // Non-blocking; eligibility can be run again from card or on reload
        }
      }
      load();
      setSelectedEvidenceByStep((prev) => ({ ...prev, [step]: new Set<string>() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(null);
    }
  };

  const toggleStep = (step: string) => {
    setSelectedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  };

  const toggleEvidenceForStep = (step: string, evidenceId: string) => {
    setSelectedEvidenceByStep((prev) => {
      const current = new Set(prev[step] ?? []);
      if (current.has(evidenceId)) current.delete(evidenceId);
      else current.add(evidenceId);
      return { ...prev, [step]: current };
    });
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  };

  const handleOpenEvidence = async (evidenceId: string) => {
    if (!projectId) return;
    setOpenError(null);
    try {
      const token = await getIdToken();
      const res = await get<{ url: string; expires_at: string }>(
        `/internal/projects/${projectId}/evidence/${evidenceId}/signed-url`,
        token
      );
      if (res?.url) window.open(res.url, "_blank", "noopener,noreferrer");
      else setOpenError("Signed URL not returned.");
    } catch {
      setOpenError("Download unavailable. Signed URL endpoint may not be available.");
    }
  };

  if (loading && !data) {
    return (
      <AdminGuard>
        <div className="container-wide">
          <div className="card">
            <div className="flex items-center gap-3">
              <span className="spinner" />
              <span className="text-muted">Loading…</span>
            </div>
          </div>
        </div>
      </AdminGuard>
    );
  }
  if (error && !data) {
    return (
      <AdminGuard>
        <div className="container">
          <div className="alert alert-error mb-4">{error}</div>
          <Link href="/admin" className="btn btn-secondary">Back to list</Link>
        </div>
      </AdminGuard>
    );
  }
  if (!data) return null;

  const { project, claims } = data;

  return (
    <AdminGuard>
      <div className="container-wide">
        <p className="mb-6">
          <Link href="/admin" className="btn btn-ghost">← Back to list</Link>
        </p>

        <div className="card mb-4">
          <h2 className="card-title">A. Project</h2>
          <p className="mb-2"><strong>Project ID</strong> {project.id}</p>
          <p className="mb-0">
            <strong>Status</strong> {project.status}
            {project.status === "VERIFIED" && <span className="badge badge-verified" style={{ marginLeft: 8 }}>VERIFIED</span>}
          </p>
        </div>

        <div className="card mb-4">
          <h2 className="card-title">B. Factory candidates</h2>
          {(claims.factory_candidate?.length ?? 0) === 0 && <p className="text-muted mb-0">No candidates.</p>}
          {(claims.factory_candidate ?? []).slice(0, 10).map((c) => (
            <div key={c.id} className="card mb-4" style={{ padding: "0.75rem 1rem", background: "var(--color-border-muted)" }}>
              <pre style={{ margin: "0 0 8px", fontSize: "0.85rem", overflow: "auto" }}>{JSON.stringify(c.valueJson, null, 2)}</pre>
              {(claims.factory_rule_flags ?? []).filter((f) => (f.valueJson as { factory_candidate_id?: string })?.factory_candidate_id === c.id).map((f) => (
                <span key={f.id} className="badge badge-warning" style={{ marginRight: 6 }}>
                  {(f.valueJson as { flags?: { flag: string }[] })?.flags?.map((x) => x.flag).join(", ")}
                </span>
              ))}
              {(claims.factory_ai_explanation ?? []).filter((e) => (e.valueJson as { factory_candidate_id?: string })?.factory_candidate_id === c.id).map((e) => (
                <div key={e.id} className="text-muted" style={{ marginTop: 6, fontSize: "0.9rem" }}>
                  AI: {(e.valueJson as { explanation?: string })?.explanation ?? "-"}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="card mb-4">
          <h2 className="card-title">C. Phase-E Execution plan</h2>
          {planSteps.length === 0 && <p className="text-muted mb-0">No execution plan.</p>}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {planSteps.map((s) => (
              <li key={s.step} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--color-border)" }}>
                <strong>{s.step}</strong> — {s.description}
              </li>
            ))}
          </ul>
        </div>

        <div className="card mb-4">
          <h2 className="card-title">D. Phase-F Approve execution</h2>
          <p className="warning mb-4">{IRREVERSIBLE_WARNING}</p>
          {planSteps.map((s) => (
            <label key={s.step} className="flex items-center gap-2 mb-2" style={{ display: "flex", cursor: "pointer" }}>
              <input type="checkbox" checked={selectedSteps.has(s.step)} onChange={() => toggleStep(s.step)} disabled={hasExecutionApproved} />
              {s.step}
              {approvedStepsSet.has(s.step) && <span className="badge badge-sent">Approved</span>}
            </label>
          ))}
          <div className="flex items-center gap-2 mt-4">
            <button type="button" className="btn btn-primary" onClick={handleApprove} disabled={selectedSteps.size === 0 || approving || hasExecutionApproved}>
              {approving ? "Approving…" : "Approve selected steps"}
            </button>
            {hasExecutionApproved && <span className="text-muted">Already approved.</span>}
          </div>
        </div>

        <div className="card mb-4">
          <h2 className="card-title">Evidence</h2>
          <p className="text-muted mb-4">Upload PDF or images. Can be linked to Phase-G steps. No edit or delete.</p>
          <label className="label">
            <input
              type="file"
              accept={ACCEPT_EVIDENCE}
              onChange={onFileChange}
              disabled={!!uploadStatus}
              className="input"
              style={{ maxWidth: 320 }}
              aria-label="Upload evidence file (PDF or image)"
            />
          </label>
          {uploadStatus && <p className="text-muted mb-2">{uploadStatus}</p>}
          {openError && <p className="alert alert-error mb-4">{openError}</p>}
          <div className="table-wrap mt-4">
            <table>
              <thead>
                <tr>
                  <th>Evidence ID</th>
                  <th>Filename</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                  <th>Uploader</th>
                  <th>Virus scan</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {evidenceList.length === 0 && (
                  <tr><td colSpan={8} className="text-muted">No evidence yet.</td></tr>
                )}
                {evidenceList.map((ev) => (
                  <tr key={ev.evidence_id}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{ev.evidence_id}</td>
                    <td>{ev.original_filename ?? "—"}</td>
                    <td>{ev.mime_type}</td>
                    <td>{ev.size_bytes.toLocaleString()} B</td>
                    <td>{new Date(ev.created_at).toLocaleString()}</td>
                    <td>{ev.uploaded_by}</td>
                    <td>{ev.virus_scan_status ?? "—"}</td>
                    <td>
                      {ev.download_url ? (
                        <a href={ev.download_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ padding: "2px 8px" }}>Open</a>
                      ) : (
                        <button type="button" className="btn btn-ghost" style={{ padding: "2px 8px" }} onClick={() => handleOpenEvidence(ev.evidence_id)} title="Open with signed URL">
                          Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card mb-4">
          <h2 className="card-title">Phase-G Mark as sent</h2>
          <p className="warning mb-4">{IRREVERSIBLE_WARNING}</p>
          {planSteps.map((s) => {
            const alreadySent = sentStepsSet.has(s.step);
            const selected = selectedEvidenceByStep[s.step] ?? new Set<string>();
            const hasSelection = selected.size > 0;
            return (
              <div key={s.step} style={{ marginBottom: "1rem", padding: "0.75rem 0", borderBottom: "1px solid var(--color-border)" }}>
                <strong>{s.step}</strong>
                {alreadySent ? (
                  <span className="badge badge-sent" style={{ marginLeft: 8 }}>Sent</span>
                ) : (
                  <>
                    <p className="text-muted mb-2 mt-2">Select evidence for this step:</p>
                    <div style={{ marginLeft: 8 }}>
                      {evidenceList.length === 0 ? (
                        <p className="text-subtle">Upload evidence above first.</p>
                      ) : (
                        evidenceList.map((ev) => (
                          <label key={ev.evidence_id} className="flex items-center gap-2 mb-2" style={{ display: "flex", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={selected.has(ev.evidence_id)}
                              onChange={() => toggleEvidenceForStep(s.step, ev.evidence_id)}
                            />
                            <span>{ev.original_filename ?? ev.evidence_id}</span>
                          </label>
                        ))
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary mt-2"
                      onClick={() => handleMarkSent(s.step)}
                      disabled={sending !== null || !hasSelection}
                    >
                      {sending === s.step ? "Sending…" : "Mark as sent"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="card mb-4">
          <h2 className="card-title">Phase-H Automation eligibility</h2>
          {(() => {
            const list = claims.automation_eligibility ?? [];
            const latest = list.length > 0 ? (list[list.length - 1].valueJson as AutomationEligibilityValue) : null;
            if (!latest) {
              return (
                <p className="text-muted mb-0">
                  No eligibility result yet. Complete at least one Phase-G “Mark as sent” to trigger evaluation.
                </p>
              );
            }
            return (
              <div className="card" style={{ padding: "0.75rem 1rem", background: "var(--color-border-muted)", maxWidth: 560 }}>
                <p className="mb-2"><strong>Eligible</strong> {latest.eligible === true ? "Yes" : latest.eligible === false ? "No" : "—"}</p>
                {latest.evaluated_at && (
                  <p className="text-muted mb-2" style={{ fontSize: "0.9rem" }}>
                    <strong>Evaluated at</strong> {new Date(latest.evaluated_at).toLocaleString()}
                  </p>
                )}
                {(latest.reasons?.length ?? 0) > 0 && (
                  <p className="mb-2"><strong>Reasons</strong> {latest.reasons!.join("; ")}</p>
                )}
                {(latest.blocked_by?.length ?? 0) > 0 && (
                  <p className="mb-0"><strong>Blocked by</strong> {latest.blocked_by!.join("; ")}</p>
                )}
              </div>
            );
          })()}
        </div>

        {info && <div className="alert alert-success mb-4">{info}</div>}
        {error && <div className="alert alert-error mb-4">{error}</div>}
      </div>
    </AdminGuard>
  );
}
