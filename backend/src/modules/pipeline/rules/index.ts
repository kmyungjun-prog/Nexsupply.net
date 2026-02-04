/**
 * Phase-C+ rule engine. Append-only flags on factory_candidate claims; no AI, no ranking.
 * Failures: log audit only; do not stop pipeline or change project state.
 */

import crypto from "node:crypto";
import { ActorRole, AuditActionType, ClaimType, ProjectStatus } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { appendClaim } from "../../claims/service.js";
import { FIELD_FACTORY_CANDIDATE, FIELD_FACTORY_RULE_FLAGS } from "../blueprint/fieldKeys.js";
import { evaluateAll } from "./rules.js";
import type { FactoryCandidateValue } from "./types.js";
import type { RuleFlag } from "./types.js";

/** Stable hash for flags+versionId to suppress duplicate flag claims (append-only preserved). */
function flagsContentHash(flags: RuleFlag[], versionId: string): string {
  return crypto.createHash("sha256").update(JSON.stringify(flags) + versionId).digest("hex").slice(0, 16);
}

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };
const SOURCE_REF = "rule_engine:v1";
const RULES_APPLIED = ["MOQ", "REGION", "PRICE_OUTLIER"];

export { evaluateAll, ruleMoq, ruleRegion, rulePriceOutlier } from "./rules.js";
export { getPriceMid } from "./priceUtils.js";
export type { PriceRange } from "./priceUtils.js";
export type { RuleFlag, RuleResult, FactoryCandidateValue, RuleContext, CandidateWithId } from "./types.js";

/**
 * Run rule engine at end of blueprint pipeline.
 * Must run only if project.status === BLUEPRINT_RUNNING and not VERIFIED.
 * On failure: log audit_actions (edit_note), do NOT throw.
 */
export async function runRuleEngine(
  projectId: string,
  versionId: string,
  idempotencyKey: string,
  requestId: string,
  log: { info: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void },
): Promise<{ factories_evaluated: number; flags_created: number }> {
  try {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) {
      log.error({ projectId }, "Rule engine: project not found");
      return { factories_evaluated: 0, flags_created: 0 };
    }
    if (project.status === ProjectStatus.VERIFIED) {
      log.info({ projectId }, "Rule engine: skip (VERIFIED)");
      return { factories_evaluated: 0, flags_created: 0 };
    }
    if (project.status !== ProjectStatus.BLUEPRINT_RUNNING) {
      log.info({ projectId, status: project.status }, "Rule engine: skip (not BLUEPRINT_RUNNING)");
      return { factories_evaluated: 0, flags_created: 0 };
    }

    const effectiveVersionId = versionId ?? project.activeVersionId ?? projectId;
    const factoryClaims = await db.sourcingClaim.findMany({
      where: {
        projectId,
        versionId: effectiveVersionId,
        fieldKey: FIELD_FACTORY_CANDIDATE,
        claimType: ClaimType.HYPOTHESIS,
      },
      select: { id: true, valueJson: true },
    });

    const candidates = factoryClaims.map((c) => ({
      claimId: c.id,
      value: c.valueJson as FactoryCandidateValue,
    }));
    if (candidates.length === 0) {
      await writeRuleEngineAudit(projectId, idempotencyKey, requestId, 0, 0, log);
      return { factories_evaluated: 0, flags_created: 0 };
    }

    const results = evaluateAll(candidates);
    let flagsCreated = 0;
    for (const r of results) {
      if (r.flags.length === 0) continue;
      const contentHash = flagsContentHash(r.flags, effectiveVersionId);
      const ruleIdempotencyKey = `rules:${idempotencyKey}:${r.claimId}:${contentHash}`;
      const existing = await db.sourcingClaim.findUnique({
        where: { projectId_idempotencyKey: { projectId, idempotencyKey: ruleIdempotencyKey } },
      });
      if (existing) continue;
      await appendClaim({
        projectId,
        actor: ACTOR_SYSTEM,
        fieldKey: FIELD_FACTORY_RULE_FLAGS,
        valueJson: {
          factory_candidate_id: r.claimId,
          flags: r.flags,
          computed_at: new Date().toISOString(),
          content_hash: contentHash,
        },
        claimType: ClaimType.HYPOTHESIS,
        sourceType: "system",
        sourceRef: SOURCE_REF,
        versionId: effectiveVersionId,
        idempotencyKey: ruleIdempotencyKey,
        requestId,
      });
      flagsCreated += 1;
    }

    await writeRuleEngineAudit(projectId, idempotencyKey, requestId, candidates.length, flagsCreated, log);
    log.info({ projectId, factories_evaluated: candidates.length, flags_created: flagsCreated }, "Phase-C+ rule engine applied");
    return { factories_evaluated: candidates.length, flags_created: flagsCreated };
  } catch (err) {
    log.error({ err, projectId }, "Rule engine failed");
    await db.auditAction.create({
      data: {
        projectId,
        actorId: ACTOR_SYSTEM.uid,
        actorRole: ACTOR_SYSTEM.role,
        actionType: AuditActionType.edit_note,
        note: JSON.stringify({
          message: `Phase-C+ rule engine failed: ${err instanceof Error ? err.message : String(err)}`,
          metadata: { rules: RULES_APPLIED, factories_evaluated: 0, flags_created: 0 },
        }),
        requestId,
        idempotencyKey: `${idempotencyKey}:rules:failed`,
      },
    });
    return { factories_evaluated: 0, flags_created: 0 };
  }
}

async function writeRuleEngineAudit(
  projectId: string,
  idempotencyKey: string,
  requestId: string,
  factoriesEvaluated: number,
  flagsCreated: number,
  log: { error: (o: unknown, msg: string) => void },
): Promise<void> {
  try {
    await db.auditAction.create({
      data: {
        projectId,
        actorId: ACTOR_SYSTEM.uid,
        actorRole: ACTOR_SYSTEM.role,
        actionType: AuditActionType.pipeline_run,
        note: JSON.stringify({
          message: "Phase-C+ rule engine applied",
          metadata: {
            rules: RULES_APPLIED,
            factories_evaluated: factoriesEvaluated,
            flags_created: flagsCreated,
          },
        }),
        requestId,
        idempotencyKey: `${idempotencyKey}:rules`,
      },
    });
  } catch (e) {
    log.error({ e, projectId }, "Rule engine audit write failed");
  }
}
