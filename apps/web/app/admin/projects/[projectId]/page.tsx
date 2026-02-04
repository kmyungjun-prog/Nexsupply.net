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
      });
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

  if (loading && !data) return <AdminGuard><div style={{ padding: "1rem" }}>Loading…</div></AdminGuard>;
  if (error && !data) return <AdminGuard><section><p style={{ color: "red" }}>{error}</p><Link href="/admin">Back</Link></section></AdminGuard>;
  if (!data) return null;

  const { project, claims } = data;

  return (
    <AdminGuard>
      <div>
        <Link href="/admin">Back to list</Link>

        <section>
          <h2>A. Project Header</h2>
          <p><strong>Project ID:</strong> {project.id}</p>
          <p><strong>Status:</strong> {project.status}</p>
          {project.status === "VERIFIED" && <span className="badge badge-verified">VERIFIED</span>}
        </section>

        <section>
          <h2>B. Factory Candidates</h2>
          {(claims.factory_candidate?.length ?? 0) === 0 && <p>No candidates.</p>}
          {(claims.factory_candidate ?? []).slice(0, 10).map((c) => (
            <div key={c.id} style={{ marginBottom: "1rem", padding: "0.75rem", border: "1px solid #eee", borderRadius: 6 }}>
              <pre style={{ margin: 0, fontSize: "0.85rem", overflow: "auto" }}>{JSON.stringify(c.valueJson, null, 2)}</pre>
              {(claims.factory_rule_flags ?? []).filter((f) => (f.valueJson as { factory_candidate_id?: string })?.factory_candidate_id === c.id).map((f) => (
                <span key={f.id} style={{ marginRight: 6, padding: "2px 6px", background: "#fef3c7", borderRadius: 4 }}>
                  {(f.valueJson as { flags?: { flag: string }[] })?.flags?.map((x) => x.flag).join(", ")}
                </span>
              ))}
              {(claims.factory_ai_explanation ?? []).filter((e) => (e.valueJson as { factory_candidate_id?: string })?.factory_candidate_id === c.id).map((e) => (
                <div key={e.id} style={{ marginTop: 6, fontSize: "0.9rem", color: "#374151" }}>
                  AI: {(e.valueJson as { explanation?: string })?.explanation ?? "-"}
                </div>
              ))}
            </div>
          ))}
        </section>

        <section>
          <h2>C. Phase-E Execution Plan</h2>
          {planSteps.length === 0 && <p>No execution plan.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {planSteps.map((s) => (
              <li key={s.step} style={{ padding: "0.5rem 0", borderBottom: "1px solid #eee" }}>
                <strong>{s.step}</strong> — Human action required. {s.description}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>D. Phase-F Approve Execution</h2>
          <p className="warning">{IRREVERSIBLE_WARNING}</p>
          {planSteps.map((s) => (
            <label key={s.step} style={{ display: "block", marginBottom: 6 }}>
              <input type="checkbox" checked={selectedSteps.has(s.step)} onChange={() => toggleStep(s.step)} disabled={hasExecutionApproved} />
              {s.step}
              {approvedStepsSet.has(s.step) && <span className="badge badge-sent" style={{ marginLeft: 8 }}>Approved</span>}
            </label>
          ))}
          <button type="button" onClick={handleApprove} disabled={selectedSteps.size === 0 || approving || hasExecutionApproved}>
            {approving ? "Approving…" : "Approve selected steps"}
          </button>
          {hasExecutionApproved && <span style={{ marginLeft: 8 }}>Already approved.</span>}
        </section>

        <section>
          <h2>Evidence</h2>
          <p>Upload PDF or images. Uploaded evidence can be linked to Phase-G steps. No delete or edit.</p>
          <label style={{ display: "block", marginBottom: 8 }}>
            <span style={{ marginRight: 8 }}>Choose file (PDF or image):</span>
            <input
              type="file"
              accept={ACCEPT_EVIDENCE}
              onChange={onFileChange}
              disabled={!!uploadStatus}
              aria-label="Upload evidence file (PDF or image)"
            />
          </label>
          {uploadStatus && <p style={{ margin: "4px 0", color: "#6b7280" }}>{uploadStatus}</p>}
          {openError && <p style={{ margin: "4px 0", color: "#b91c1c", fontSize: "0.9rem" }}>{openError}</p>}
          <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd" }}>
                <th style={{ textAlign: "left", padding: 6 }}>Evidence ID</th>
                <th style={{ textAlign: "left", padding: 6 }}>Filename</th>
                <th style={{ textAlign: "left", padding: 6 }}>MIME type</th>
                <th style={{ textAlign: "left", padding: 6 }}>Size</th>
                <th style={{ textAlign: "left", padding: 6 }}>Created</th>
                <th style={{ textAlign: "left", padding: 6 }}>Uploader</th>
                <th style={{ textAlign: "left", padding: 6 }}>Virus scan</th>
                <th style={{ textAlign: "left", padding: 6 }}>Open</th>
              </tr>
            </thead>
            <tbody>
              {evidenceList.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 8, color: "#6b7280" }}>No evidence yet.</td></tr>
              )}
              {evidenceList.map((ev) => (
                <tr key={ev.evidence_id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: 6, fontFamily: "monospace", fontSize: "0.85rem" }}>{ev.evidence_id}</td>
                  <td style={{ padding: 6 }}>{ev.original_filename ?? "—"}</td>
                  <td style={{ padding: 6 }}>{ev.mime_type}</td>
                  <td style={{ padding: 6 }}>{ev.size_bytes.toLocaleString()} B</td>
                  <td style={{ padding: 6 }}>{new Date(ev.created_at).toLocaleString()}</td>
                  <td style={{ padding: 6 }}>{ev.uploaded_by}</td>
                  <td style={{ padding: 6 }}>{ev.virus_scan_status ?? "—"}</td>
                  <td style={{ padding: 6 }}>
                    {ev.download_url ? (
                      <a href={ev.download_url} target="_blank" rel="noopener noreferrer">Open</a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenEvidence(ev.evidence_id)}
                        title="Open with short-lived signed URL (Auditor Desk document viewer)"
                      >
                        Open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Phase-G Mark as Sent</h2>
          <p className="warning">{IRREVERSIBLE_WARNING}</p>
          {planSteps.map((s) => {
            const alreadySent = sentStepsSet.has(s.step);
            const selected = selectedEvidenceByStep[s.step] ?? new Set<string>();
            const hasSelection = selected.size > 0;
            return (
              <div key={s.step} style={{ marginBottom: "1rem", padding: "0.5rem 0", borderBottom: "1px solid #eee" }}>
                <strong>{s.step}</strong>
                {alreadySent ? (
                  <span className="badge badge-sent" style={{ marginLeft: 8 }}>Sent</span>
                ) : (
                  <>
                    <p style={{ margin: "6px 0 4px", fontSize: "0.9rem" }}>Select evidence for this step:</p>
                    <div style={{ marginLeft: 8 }}>
                      {evidenceList.length === 0 ? (
                        <p style={{ color: "#6b7280", fontSize: "0.85rem" }}>Upload evidence above first.</p>
                      ) : (
                        evidenceList.map((ev) => (
                          <label key={ev.evidence_id} style={{ display: "block", marginBottom: 4 }}>
                            <input
                              type="checkbox"
                              checked={selected.has(ev.evidence_id)}
                              onChange={() => toggleEvidenceForStep(s.step, ev.evidence_id)}
                            />
                            <span style={{ marginLeft: 6 }}>{ev.original_filename ?? ev.evidence_id}</span>
                          </label>
                        ))
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleMarkSent(s.step)}
                      disabled={sending !== null || !hasSelection}
                      style={{ marginTop: 6 }}
                    >
                      {sending === s.step ? "Sending…" : "Mark as Sent"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </section>

        <section>
          <h2>Phase-H Automation Eligibility</h2>
          {(() => {
            const list = claims.automation_eligibility ?? [];
            const latest = list.length > 0 ? (list[list.length - 1].valueJson as AutomationEligibilityValue) : null;
            if (!latest) {
              return (
                <p style={{ color: "#6b7280" }}>
                  No eligibility result yet. Complete at least one Phase-G &quot;Mark as Sent&quot; to trigger evaluation.
                </p>
              );
            }
            return (
              <div style={{ padding: "0.75rem", border: "1px solid #e5e7eb", borderRadius: 6, maxWidth: 560 }}>
                <p style={{ margin: "0 0 8px" }}>
                  <strong>Eligible:</strong> {latest.eligible === true ? "Yes" : latest.eligible === false ? "No" : "—"}
                </p>
                {latest.evaluated_at && (
                  <p style={{ margin: "0 0 8px", fontSize: "0.9rem", color: "#6b7280" }}>
                    <strong>Evaluated at:</strong> {new Date(latest.evaluated_at).toLocaleString()}
                  </p>
                )}
                {(latest.reasons?.length ?? 0) > 0 && (
                  <p style={{ margin: "0 0 8px" }}>
                    <strong>Reasons:</strong> {latest.reasons!.join("; ")}
                  </p>
                )}
                {(latest.blocked_by?.length ?? 0) > 0 && (
                  <p style={{ margin: 0 }}>
                    <strong>Blocked by:</strong> {latest.blocked_by!.join("; ")}
                  </p>
                )}
              </div>
            );
          })()}
        </section>

        {info && <section><p style={{ color: "#059669" }}>{info}</p></section>}
        {error && <section><p style={{ color: "red" }}>{error}</p></section>}
      </div>
    </AdminGuard>
  );
}
