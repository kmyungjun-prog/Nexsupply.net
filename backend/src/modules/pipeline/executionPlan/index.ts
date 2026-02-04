/**
 * Phase-E: Execution planning. Runs ONLY when project is VERIFIED.
 * Generates execution_plan and execution_cost_preview claims (append-only).
 * Does not change project status; does not execute any action.
 *
 * TODO: Phase-F execution automation (human approval mandatory per step).
 * TODO: UI action wiring (steps → confirm / reject).
 * TODO: Localization (step descriptions, risks).
 */

import { ActorRole, AuditActionType, ClaimType, ProjectStatus } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { appendClaim } from "../../claims/service.js";
import { FIELD_EXECUTION_PLAN, FIELD_EXECUTION_COST_PREVIEW } from "../blueprint/fieldKeys.js";
import { assertProjectVerified } from "./safeguards.js";
import { buildExecutionPlanValue } from "./plan.js";
import { buildExecutionCostPreviewValue } from "./costPreview.js";

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };
const SOURCE_REF_PLAN = "execution_planner:v1";
const SOURCE_REF_COST = "execution_cost_estimator:v1";

export type PhaseEResult = { ok: boolean; verified_version_id?: string };

/**
 * Run Phase-E only when project.status === VERIFIED and verifiedSnapshotJsonb and verifiedVersionId exist.
 * On entry condition failure: write audit (edit_note), return { ok: false }. Do not throw.
 * On success: append execution_plan and execution_cost_preview claims, write pipeline_run audit.
 */
export async function runPhaseE(
  projectId: string,
  idempotencyKey: string,
  requestId: string,
  log: { info: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void },
): Promise<PhaseEResult> {
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
      log.error({ projectId }, "Phase-E: project not found");
      await writePhaseEAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-E aborted: project not found",
      });
      return { ok: false };
    }

    if (project.status !== ProjectStatus.VERIFIED) {
      log.info({ projectId, status: project.status }, "Phase-E: skip (not VERIFIED)");
      await writePhaseEAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-E aborted: project not VERIFIED",
        status: project.status,
      });
      return { ok: false };
    }

    if (project.verifiedSnapshotJsonb == null) {
      log.info({ projectId }, "Phase-E: skip (no verified_snapshot_jsonb)");
      await writePhaseEAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-E aborted: verifiedSnapshotJsonb missing",
      });
      return { ok: false };
    }

    if (project.verifiedVersionId == null || project.verifiedVersionId === "") {
      log.info({ projectId }, "Phase-E: skip (no verified_version_id)");
      await writePhaseEAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-E aborted: verifiedVersionId missing",
      });
      return { ok: false };
    }

    assertProjectVerified(project);

    const verifiedVersionId = project.verifiedVersionId;
    const snapshot = project.verifiedSnapshotJsonb;

    const planValue = buildExecutionPlanValue(verifiedVersionId, snapshot);
    const costValue = buildExecutionCostPreviewValue(snapshot);

    await appendClaim({
      projectId,
      actor: ACTOR_SYSTEM,
      fieldKey: FIELD_EXECUTION_PLAN,
      valueJson: planValue,
      claimType: ClaimType.HYPOTHESIS,
      sourceType: "system",
      sourceRef: SOURCE_REF_PLAN,
      versionId: verifiedVersionId,
      idempotencyKey: `${idempotencyKey}:execution_plan`,
      requestId,
      allowWhenVerified: true,
    });

    await appendClaim({
      projectId,
      actor: ACTOR_SYSTEM,
      fieldKey: FIELD_EXECUTION_COST_PREVIEW,
      valueJson: costValue,
      claimType: ClaimType.HYPOTHESIS,
      sourceType: "system",
      sourceRef: SOURCE_REF_COST,
      versionId: verifiedVersionId,
      idempotencyKey: `${idempotencyKey}:execution_cost_preview`,
      requestId,
      allowWhenVerified: true,
    });

    await writePhaseEAudit(projectId, requestId, `${idempotencyKey}:execution_plan`, "pipeline_run", {
      message: "Phase-E execution plan generated",
      verified_version_id: verifiedVersionId,
    });

    log.info({ projectId, verified_version_id: verifiedVersionId }, "Phase-E execution plan generated");
    return { ok: true, verified_version_id: verifiedVersionId };
  } catch (err) {
    log.error({ err, projectId }, "Phase-E failed");
    await writePhaseEAudit(projectId, requestId, idempotencyKey, "edit_note", {
      message: `Phase-E failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { ok: false };
  }
}

async function writePhaseEAudit(
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
