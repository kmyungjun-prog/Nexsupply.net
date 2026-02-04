/**
 * Phase-H: Collect data and evaluate eligibility.
 * No side effects except returning result; claim append is in index.ts.
 */

import { ClaimType, Prisma } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { FIELD_EXECUTION_ACTION_RESULT } from "../blueprint/fieldKeys.js";
import { skuFingerprint } from "./fingerprint.js";
import { evaluateEligibility } from "./rules.js";
import type { EligibilityResult } from "./rules.js";

export type AutomationEligibilityValueJson = {
  sku_fingerprint: string;
  eligible: boolean;
  reasons: string[];
  blocked_by: string[];
  based_on_execution_steps: string[];
  evaluated_at: string;
};

export type EvaluateInput = {
  projectId: string;
  verifiedVersionId: string;
  snapshot: unknown;
};

export type EvaluateOutput = {
  valueJson: AutomationEligibilityValueJson;
  result: EligibilityResult;
};

/**
 * Collect execution steps from execution_action_result claims,
 * find prior VERIFIED project with same sku_fingerprint,
 * evaluate rules, return value_json for claim.
 */
export async function evaluateEligibilityForProject(input: EvaluateInput): Promise<EvaluateOutput> {
  const { projectId, verifiedVersionId, snapshot } = input;

  const fingerprint = skuFingerprint(snapshot);

  const executionResults = await db.sourcingClaim.findMany({
    where: {
      projectId,
      versionId: verifiedVersionId,
      fieldKey: FIELD_EXECUTION_ACTION_RESULT,
      claimType: ClaimType.VERIFIED,
    },
    select: { valueJson: true },
  });

  const basedOnSteps = executionResults
    .map((c) => (c.valueJson as { step?: string })?.step)
    .filter((s): s is string => typeof s === "string");

  const hasExecutionResult = executionResults.length >= 1;

  const verifiedProjects = await db.project.findMany({
    where: {
      status: "VERIFIED",
      verifiedVersionId: { not: null },
      verifiedSnapshotJsonb: { not: Prisma.DbNull },
      id: { not: projectId },
    },
    select: { id: true, verifiedSnapshotJsonb: true },
  });

  let priorSnapshot: unknown | null = null;
  for (const p of verifiedProjects) {
    if (p.verifiedSnapshotJsonb == null) continue;
    const fp = skuFingerprint(p.verifiedSnapshotJsonb);
    if (fp === fingerprint) {
      priorSnapshot = p.verifiedSnapshotJsonb;
      break;
    }
  }

  const result = evaluateEligibility(snapshot, basedOnSteps, priorSnapshot, hasExecutionResult);

  const valueJson: AutomationEligibilityValueJson = {
    sku_fingerprint: fingerprint,
    eligible: result.eligible,
    reasons: result.reasons,
    blocked_by: result.blocked_by,
    based_on_execution_steps: result.based_on_execution_steps,
    evaluated_at: new Date().toISOString(),
  };

  return { valueJson, result };
}
