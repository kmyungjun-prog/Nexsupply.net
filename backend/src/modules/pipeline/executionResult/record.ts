/**
 * Phase-G: Record human-declared execution with evidence.
 * Writes execution_marked_sent audit and appends VERIFIED execution_action_result claim.
 * NEVER updates execution_action; NEVER creates duplicate VERIFIED result for same step.
 */

import { ActorRole, AuditActionType, ClaimType } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { appendClaim } from "../../claims/service.js";
import { FIELD_EXECUTION_ACTION_RESULT } from "../blueprint/fieldKeys.js";
import {
  assertProjectVerified,
  assertPreparedExecutionActionExists,
  assertEvidenceExists,
  assertHumanActor,
  assertNoStateTransition,
  assertNoExternalApiCall,
} from "./safeguards.js";

const SOURCE_REF = "execution_result:v1";

export type ExecutionActionResultValueJson = {
  step: string;
  result: "sent";
  sent_at: string;
  evidence_ids: string[];
};

/**
 * Validate safeguards, write execution_marked_sent audit, append execution_action_result VERIFIED claim.
 * Idempotency per step: idempotency_key = ${idempotencyKey}:execution_result:${step}.
 */
export async function recordExecutionResult(
  projectId: string,
  step: string,
  evidenceIds: string[],
  actor: { uid: string; role: ActorRole },
  verifiedVersionId: string,
  idempotencyKey: string,
  requestId: string,
  log: { info: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void },
): Promise<{ ok: boolean; alreadyRecorded?: boolean }> {
  assertNoStateTransition();
  assertNoExternalApiCall();
  assertHumanActor(actor);

  const stepIdempotencyKey = `${idempotencyKey}:execution_result:${step}`;
  const existingResult = await db.sourcingClaim.findUnique({
    where: {
      projectId_idempotencyKey: { projectId, idempotencyKey: stepIdempotencyKey },
    },
    select: { id: true },
  });
  if (existingResult) {
    log.info({ projectId, step }, "Phase-G execution already recorded (idempotent skip)");
    return { ok: true, alreadyRecorded: true };
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, status: true, verifiedVersionId: true },
  });
  if (!project) {
    throw new Error("Project not found");
  }
  assertProjectVerified(project);

  const executionActionClaims = await db.sourcingClaim.findMany({
    where: {
      projectId,
      versionId: verifiedVersionId,
      fieldKey: "execution_action",
      claimType: ClaimType.HYPOTHESIS,
    },
    orderBy: { createdAt: "desc" },
    select: { valueJson: true },
  });

  const stepClaim = executionActionClaims.find((c: { valueJson: unknown }) => {
    const v = c.valueJson as { step?: string; status?: string };
    return v?.step === step && v?.status === "prepared";
  }) ?? null;

  assertPreparedExecutionActionExists(stepClaim);

  const evidenceFiles = await db.evidenceFile.findMany({
    where: { id: { in: evidenceIds }, projectId },
    select: { id: true, sha256: true },
  });
  assertEvidenceExists(evidenceIds, evidenceFiles.length, projectId);

  const sentAt = new Date().toISOString();

  await db.auditAction.create({
    data: {
      projectId,
      actorId: actor.uid,
      actorRole: actor.role,
      actionType: AuditActionType.execution_marked_sent,
      note: JSON.stringify({
        step,
        sent_at: sentAt,
        evidence_ids: evidenceIds,
      }),
      requestId,
      idempotencyKey: `${idempotencyKey}:execution_marked_sent:${step}`,
    },
  });

  const valueJson: ExecutionActionResultValueJson = {
    step,
    result: "sent",
    sent_at: sentAt,
    evidence_ids: evidenceIds,
  };

  await appendClaim({
    projectId,
    actor,
    fieldKey: FIELD_EXECUTION_ACTION_RESULT,
    valueJson,
    claimType: ClaimType.VERIFIED,
    sourceType: "user",
    sourceRef: SOURCE_REF,
    versionId: verifiedVersionId,
    idempotencyKey: stepIdempotencyKey,
    requestId,
    evidenceIds,
    allowVerifiedResult: true,
  });

  log.info({ projectId, step }, "Phase-G execution recorded");
  return { ok: true };
}
