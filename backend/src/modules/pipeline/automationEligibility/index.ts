/**
 * Phase-H: Repeat SKU Automation Eligibility (guardrails only).
 * Evaluates eligibility without performing any automatic execution.
 * Append-only; no state changes; safe by default (eligible = false unless proven).
 *
 * TODO: Phase-I actual automation (out of scope).
 * TODO: UI to display eligibility result.
 * TODO: Notifications (out of scope).
 */

import { ActorRole, AuditActionType, ClaimType, ProjectStatus } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { appendClaim } from "../../claims/service.js";
import { FIELD_AUTOMATION_ELIGIBILITY } from "../blueprint/fieldKeys.js";
import { assertProjectVerified, assertExecutionResultExists } from "./safeguards.js";
import { evaluateEligibilityForProject } from "./evaluate.js";

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };
const SOURCE_REF = "automation_guard:v1";

export type PhaseHResult = { ok: boolean; eligible?: boolean };

/**
 * Run Phase-H only when: VERIFIED, verifiedSnapshotJsonb, verifiedVersionId, at least one execution_action_result.
 * On entry failure: audit edit_note, return { ok: false }. Do not throw.
 * On success: append automation_eligibility claim, pipeline_run audit.
 * Idempotency: one claim per (projectId, idempotencyKey); re-run does not duplicate.
 */
export async function runPhaseH(
  projectId: string,
  idempotencyKey: string,
  requestId: string,
  log: { info: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void },
): Promise<PhaseHResult> {
  const stepIdempotencyKey = `${idempotencyKey}:automation_eligibility`;

  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        status: true,
        verifiedSnapshotJsonb: true,
        verifiedVersionId: true,
      },
    });

    if (!project) {
      log.error({ projectId }, "Phase-H: project not found");
      await writePhaseHAudit(projectId, requestId, stepIdempotencyKey, "edit_note", {
        message: "Phase-H aborted: project not found",
      });
      return { ok: false };
    }

    if (project.status !== ProjectStatus.VERIFIED) {
      log.info({ projectId, status: project.status }, "Phase-H: skip (not VERIFIED)");
      await writePhaseHAudit(projectId, requestId, stepIdempotencyKey, "edit_note", {
        message: "Phase-H aborted: project not VERIFIED",
        status: project.status,
      });
      return { ok: false };
    }

    if (project.verifiedSnapshotJsonb == null) {
      log.info({ projectId }, "Phase-H: skip (no verifiedSnapshotJsonb)");
      await writePhaseHAudit(projectId, requestId, stepIdempotencyKey, "edit_note", {
        message: "Phase-H aborted: verifiedSnapshotJsonb missing",
      });
      return { ok: false };
    }

    if (project.verifiedVersionId == null || project.verifiedVersionId === "") {
      log.info({ projectId }, "Phase-H: skip (no verifiedVersionId)");
      await writePhaseHAudit(projectId, requestId, stepIdempotencyKey, "edit_note", {
        message: "Phase-H aborted: verifiedVersionId missing",
      });
      return { ok: false };
    }

    assertProjectVerified(project);

    const executionResultCount = await db.sourcingClaim.count({
      where: {
        projectId,
        versionId: project.verifiedVersionId,
        fieldKey: "execution_action_result",
        claimType: ClaimType.VERIFIED,
      },
    });

    try {
      assertExecutionResultExists(executionResultCount);
    } catch {
      log.info({ projectId }, "Phase-H: skip (no execution_action_result)");
      await writePhaseHAudit(projectId, requestId, stepIdempotencyKey, "edit_note", {
        message: "Phase-H aborted: at least one execution_action_result (Phase-G) required",
      });
      return { ok: false };
    }

    const existingClaim = await db.sourcingClaim.findUnique({
      where: {
        projectId_idempotencyKey: { projectId, idempotencyKey: stepIdempotencyKey },
      },
      select: { id: true, valueJson: true },
    });

    if (existingClaim) {
      log.info({ projectId }, "Phase-H: already evaluated (idempotent skip)");
      const v = existingClaim.valueJson as { eligible?: boolean };
      return { ok: true, eligible: v?.eligible };
    }

    const verifiedVersionId = project.verifiedVersionId;
    const snapshot = project.verifiedSnapshotJsonb;

    const { valueJson } = await evaluateEligibilityForProject({
      projectId,
      verifiedVersionId,
      snapshot,
    });

    await appendClaim({
      projectId,
      actor: ACTOR_SYSTEM,
      fieldKey: FIELD_AUTOMATION_ELIGIBILITY,
      valueJson,
      claimType: ClaimType.HYPOTHESIS,
      sourceType: "system",
      sourceRef: SOURCE_REF,
      versionId: verifiedVersionId,
      idempotencyKey: stepIdempotencyKey,
      requestId,
      allowWhenVerified: true,
    });

    await writePhaseHAudit(projectId, requestId, stepIdempotencyKey, "pipeline_run", {
      message: "Phase-H automation eligibility evaluated",
      verified_version_id: verifiedVersionId,
      eligible: valueJson.eligible,
    });

    log.info({ projectId, eligible: valueJson.eligible }, "Phase-H automation eligibility evaluated");
    return { ok: true, eligible: valueJson.eligible };
  } catch (err) {
    log.error({ err, projectId }, "Phase-H failed");
    await writePhaseHAudit(projectId, requestId, stepIdempotencyKey, "edit_note", {
      message: `Phase-H failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { ok: false };
  }
}

async function writePhaseHAudit(
  projectId: string,
  requestId: string,
  idempotencyKey: string,
  actionType: "pipeline_run" | "edit_note",
  note: Record<string, unknown>,
): Promise<void> {
  await db.auditAction.create({
    data: {
      projectId,
      actorId: ACTOR_SYSTEM.uid,
      actorRole: ACTOR_SYSTEM.role,
      actionType,
      note: JSON.stringify(note),
      requestId,
      idempotencyKey,
    },
  });
}
