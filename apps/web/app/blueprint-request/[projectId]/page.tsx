"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { post } from "@/lib/api";

export default function BlueprintRequestPage() {
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  if (!projectId) return null;

  const { getIdToken } = useAuth();
  const [quantity, setQuantity] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [specialReq, setSpecialReq] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    if (!projectId || loading) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      const idempotencyKeyClaims = `blueprint-request-fields:${projectId}:${Date.now()}`;
      const valueJson: Record<string, string> = {};
      if (quantity.trim()) valueJson.quantity = quantity.trim();
      if (targetPrice.trim()) valueJson.target_price = targetPrice.trim();
      if (leadTime.trim()) valueJson.lead_time = leadTime.trim();
      if (specialReq.trim()) valueJson.special_requirements = specialReq.trim();
      if (Object.keys(valueJson).length > 0) {
        await post(
          "/claims",
          {
            projectId,
            fieldKey: "blueprint_request",
            valueJson,
            claimType: "USER_PROVIDED",
            versionId: projectId,
            idempotencyKey: idempotencyKeyClaims,
          },
          token,
          idempotencyKeyClaims
        );
      }
      const idempotencyKey = `blueprint-request:${projectId}:${Date.now()}`;
      await post(
        `/projects/${projectId}/transition`,
        { toStatus: "WAITING_PAYMENT", source: "ui" },
        token,
        idempotencyKey
      );
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="container">
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <h1 className="mb-4">Blueprint request received</h1>
          <p className="text-muted mb-6">Your request has been submitted. We’ll update you on progress.</p>
          <Link href="/" className="btn btn-primary">Back to home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 className="mb-2">Request Blueprint</h1>
      <p className="text-muted mb-6">Project: {projectId}</p>

      <div className="card mb-4">
        <h3 className="card-title">Optional fields</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label className="label">Quantity</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. 1000 pcs"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Target price</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. $2.50"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Lead time</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. 14 days"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Special requirements</label>
            <textarea
              className="textarea"
              placeholder="Packaging, logo, colors, etc."
              value={specialReq}
              onChange={(e) => setSpecialReq(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button type="button" className="btn btn-accent" onClick={handleStart} disabled={loading}>
            {loading ? "Submitting…" : "Request Blueprint analysis ($49)"}
          </button>
          <Link href={`/report/${projectId}`} className="btn btn-secondary">Cancel</Link>
        </div>

        {error && <div className="alert alert-error mt-4">{error}</div>}
      </div>

      <Link href="/" className="btn btn-ghost">Back to home</Link>
    </div>
  );
}
