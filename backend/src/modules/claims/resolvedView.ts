import type { SourcingClaim } from "@prisma/client";

/**
 * Resolved View 규칙(Phase-A 최소):
 * - 동일 versionId 내에서 fieldKey별 "가장 마지막에 추가된 claim"을 최종 값으로 본다.
 * - 값은 JSONB 스냅샷으로 projects.resolved_view_jsonb에 저장한다.
 *
 * TODO(M2 확장): 신뢰도/claimType 우선순위(VERIFIED > USER_PROVIDED > HYPOTHESIS) 기반 해석 규칙,
 *               field별 스키마/단위/통화 표준화, evidence 기반 가중치 등을 추가.
 */
export type ResolvedField = {
  claimId: string;
  fieldKey: string;
  value: unknown;
  claimType: SourcingClaim["claimType"];
  confidence: number | null;
  createdAt: string;
};

export type ResolvedView = {
  versionId: string;
  fields: Record<string, ResolvedField>;
};

export function buildResolvedView(versionId: string, claims: SourcingClaim[]): ResolvedView {
  const fields: Record<string, ResolvedField> = {};
  for (const c of claims) {
    fields[c.fieldKey] = {
      claimId: c.id,
      fieldKey: c.fieldKey,
      value: c.valueJson as unknown,
      claimType: c.claimType,
      confidence: c.confidence ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }
  return { versionId, fields };
}

