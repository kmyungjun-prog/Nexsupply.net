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
          <h1 className="mb-4">Blueprint 요청 접수</h1>
          <p className="text-muted mb-6">요청이 접수되었습니다. 진행 상황을 안내해 드리겠습니다.</p>
          <Link href="/" className="btn btn-primary">홈으로</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 className="mb-2">Blueprint 요청</h1>
      <p className="text-muted mb-6">프로젝트: {projectId}</p>

      <div className="card mb-4">
        <h3 className="card-title">선택 입력 (선택 사항)</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label className="label">수량</label>
            <input
              type="text"
              className="input"
              placeholder="예: 1000 pcs"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div>
            <label className="label">목표 단가</label>
            <input
              type="text"
              className="input"
              placeholder="예: $2.50"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="label">리드타임</label>
            <input
              type="text"
              className="input"
              placeholder="예: 14 days"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
            />
          </div>
          <div>
            <label className="label">특별 요청</label>
            <textarea
              className="textarea"
              placeholder="패키징, 로고, 색상 등"
              value={specialReq}
              onChange={(e) => setSpecialReq(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button type="button" className="btn btn-accent" onClick={handleStart} disabled={loading}>
            {loading ? "요청 중…" : "Blueprint 분석 요청 ($49)"}
          </button>
          <Link href={`/report/${projectId}`} className="btn btn-secondary">취소</Link>
        </div>

        {error && <div className="alert alert-error mt-4">{error}</div>}
      </div>

      <Link href="/" className="btn btn-ghost">홈으로</Link>
    </div>
  );
}
