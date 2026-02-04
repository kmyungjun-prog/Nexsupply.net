import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  fetchBlueprintReview,
  approveExecution,
  markSent,
} from "../api/client";
import type { BlueprintReviewResponse, ClaimSummary } from "../types/blueprint-review";

const IRREVERSIBLE_WARNING = "This action cannot be undone.";

export default function BlueprintReviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<BlueprintReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSteps, setSelectedSteps] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [evidenceIdsInput, setEvidenceIdsInput] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    fetchBlueprintReview(projectId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const hasExecutionApproved = data?.hasExecutionApproved ?? false;
  const planSteps = (data?.claims?.execution_plan?.[0]?.valueJson as { steps?: { step: string }[] })?.steps ?? [];
  const stepIds = planSteps.map((s) => s.step);

  const approvedStepsSet = new Set<string>();
  (data?.claims?.execution_action ?? []).forEach((c: ClaimSummary) => {
    const step = (c.valueJson as { step?: string })?.step;
    if (step) approvedStepsSet.add(step);
  });

  const sentStepsSet = new Set(
    (data?.claims?.execution_action_result ?? []).map((c) => (c.valueJson as { step?: string })?.step).filter(Boolean) as string[]
  );

  const handleApprove = async () => {
    if (!projectId || selectedSteps.size === 0 || approving) return;
    setApproving(true);
    try {
      await approveExecution(
        projectId,
        Array.from(selectedSteps),
        `approve:${projectId}`
      );
      const next = await fetchBlueprintReview(projectId);
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  };

  const handleMarkSent = async (step: string) => {
    if (!projectId || sending) return;
    const raw = evidenceIdsInput[step]?.trim();
    const ids = raw ? raw.split(/[\s,]+/).filter(Boolean) : [];
    if (ids.length === 0) {
      setError("Enter at least one evidence ID (comma-separated).");
      return;
    }
    setSending(step);
    setError(null);
    try {
      await markSent(projectId, step, ids);
      const next = await fetchBlueprintReview(projectId);
      setData(next);
      setEvidenceIdsInput((prev) => ({ ...prev, [step]: "" }));
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

  if (loading) return <section>Loading...</section>;
  if (error && !data) return <section><p style={{ color: "red" }}>{error}</p><button type="button" onClick={() => navigate("/")}>Back</button></section>;
  if (!data) return null;

  const { project, claims } = data;

  return (
    <div>
      <button type="button" onClick={() => navigate("/")}>Back to home</button>

      {/* Project Header */}
      <section>
        <h2>Project</h2>
        <p><strong>ID:</strong> {project.id}</p>
        <p><strong>Status:</strong> {project.status}</p>
        {project.status === "VERIFIED" && <span className="badge badge-verified">VERIFIED</span>}
      </section>

      {/* Factory Candidates */}
      <section>
        <h2>Factory Candidates</h2>
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

      {/* Execution Plan (Phase-E) */}
      <section>
        <h2>Execution Plan (Phase-E)</h2>
        {planSteps.length === 0 && <p>No execution plan.</p>}
        <ul style={{ listStyle: "none", padding: 0 }}>
          {planSteps.map((s) => (
            <li key={s.step} style={{ padding: "0.5rem 0", borderBottom: "1px solid #eee" }}>
              <strong>{s.step}</strong> — Human action required. {(s as { description?: string }).description}
            </li>
          ))}
        </ul>
      </section>

      {/* Approve for Execution (Phase-F trigger) */}
      <section>
        <h2>Approve for Execution (Phase-F)</h2>
        <p className="warning">{IRREVERSIBLE_WARNING}</p>
        {stepIds.map((step) => (
          <label key={step} style={{ display: "block", marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={selectedSteps.has(step)}
              onChange={() => toggleStep(step)}
              disabled={approvedStepsSet.has(step)}
            />
            {step}
            {approvedStepsSet.has(step) && <span className="badge badge-sent" style={{ marginLeft: 8 }}>Approved</span>}
          </label>
        ))}
        <button
          type="button"
          onClick={handleApprove}
          disabled={selectedSteps.size === 0 || approving || hasExecutionApproved}
        >
          {approving ? "Approving…" : "Approve selected steps"}
        </button>
        {hasExecutionApproved && <span style={{ marginLeft: 8 }}>Already approved.</span>}
      </section>

      {/* Execution Actions (Phase-F output) */}
      <section>
        <h2>Execution Actions (Phase-F)</h2>
        {(claims.execution_action ?? []).length === 0 && <p>No prepared actions. Approve steps above first.</p>}
        {(claims.execution_action ?? []).map((c) => {
          const v = c.valueJson as { step?: string; status?: string; artifacts?: unknown };
          return (
            <div key={c.id} style={{ marginBottom: "1rem", padding: "0.75rem", border: "1px solid #eee", borderRadius: 6 }}>
              <strong>{v?.step}</strong> — Status: {v?.status ?? "prepared"}
              <pre style={{ margin: "0.5rem 0", fontSize: "0.8rem" }}>{JSON.stringify(v?.artifacts, null, 2)}</pre>
            </div>
          );
        })}
      </section>

      {/* Mark as Sent (Phase-G) */}
      <section>
        <h2>Mark as Sent (Phase-G)</h2>
        <p className="warning">{IRREVERSIBLE_WARNING}</p>
        {planSteps.map((step) => {
          const alreadySent = sentStepsSet.has(step);
          return (
            <div key={step} style={{ marginBottom: "1rem" }}>
              <strong>{step}</strong>
              {alreadySent ? (
                <span className="badge badge-sent" style={{ marginLeft: 8 }}>Sent</span>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Evidence IDs (comma-separated)"
                    value={evidenceIdsInput[step] ?? ""}
                    onChange={(e) => setEvidenceIdsInput((prev) => ({ ...prev, [step]: e.target.value }))}
                    style={{ display: "block", marginTop: 4 }}
                  />
                  <button
                    type="button"
                    onClick={() => handleMarkSent(step)}
                    disabled={sending !== null}
                  >
                    {sending === step ? "Sending…" : "Mark as Sent"}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </section>

      {error && <section><p style={{ color: "red" }}>{error}</p></section>}
    </div>
  );
}
