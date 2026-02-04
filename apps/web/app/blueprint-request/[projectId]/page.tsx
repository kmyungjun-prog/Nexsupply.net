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
      <section>
        <h2>Blueprint analysis started</h2>
        <p>Blueprint analysis started. We’ll update you soon.</p>
        <Link href="/">Back to home</Link>
      </section>
    );
  }

  return (
    <section>
      <h2>Request Blueprint</h2>
      <p>Project: {projectId}</p>
      <p>Optional:</p>
      <input
        type="text"
        placeholder="Quantity"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <input
        type="text"
        placeholder="Target price"
        value={targetPrice}
        onChange={(e) => setTargetPrice(e.target.value)}
      />
      <input
        type="text"
        placeholder="Lead time"
        value={leadTime}
        onChange={(e) => setLeadTime(e.target.value)}
      />
      <textarea
        placeholder="Special requirements"
        value={specialReq}
        onChange={(e) => setSpecialReq(e.target.value)}
      />
      <button type="button" onClick={handleStart} disabled={loading}>
        {loading ? "Starting…" : "Start Blueprint Analysis"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <p><Link href="/">Back</Link></p>
    </section>
  );
}
