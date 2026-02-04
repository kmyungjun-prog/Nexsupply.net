/**
 * Phase-F: Controlled execution. Prepares artifacts ONLY after human approval.
 * Does NOT send, pay, order, or change project status.
 *
 * TODO: Phase-G (sending / execution); human approval remains mandatory.
 * TODO: UI wiring (approved_steps → confirm / send).
 * TODO: Localization (artifacts, templates).
 */

import { ActorRole, AuditActionType, ClaimType, ProjectStatus } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { FIELD_EXECUTION_PLAN, FIELD_EXECUTION_COST_PREVIEW } from "../blueprint/fieldKeys.js";
import {
  assertProjectVerified,
  assertExecutionPlanExists,
  assertHumanApprovalExists,
  assertNoExternalApiCall,
  assertNoStateTransition,
} from "./safeguards.js";
import { prepareExecutionActions } from "./prepare.js";

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };

export type PhaseFResult = { ok: boolean; steps_prepared?: number };

/**
 * Run Phase-F only when: VERIFIED, execution_plan exists, execution_cost_preview exists, execution_approved audit exists.
 * On entry failure: audit edit_note, return { ok: false }. Do not throw.
 * On success: pipeline_run audit with steps_prepared; return { ok: true, steps_prepared }.
 */
export async function runPhaseF(
  projectId: string,
  idempotencyKey: string,
  requestId: string,
  log: { info: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void },
): Promise<PhaseFResult> {
  assertNoExternalApiCall();
  assertNoStateTransition();

  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, verifiedVersionId: true },
    });

    if (!project) {
      log.error({ projectId }, "Phase-F: project not found");
      await writePhaseFAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-F aborted: project not found",
      });
      return { ok: false };
    }

    if (project.status !== ProjectStatus.VERIFIED) {
      log.info({ projectId, status: project.status }, "Phase-F: skip (not VERIFIED)");
      await writePhaseFAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-F aborted: project not VERIFIED",
        status: project.status,
      });
      return { ok: false };
    }

    if (project.verifiedVersionId == null || project.verifiedVersionId === "") {
      log.info({ projectId }, "Phase-F: skip (no verified_version_id)");
      await writePhaseFAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-F aborted: verifiedVersionId missing",
      });
      return { ok: false };
    }

    const verifiedVersionId = project.verifiedVersionId;

    const executionPlanClaim = await db.sourcingClaim.findFirst({
      where: {
        projectId,
        versionId: verifiedVersionId,
        fieldKey: FIELD_EXECUTION_PLAN,
        claimType: ClaimType.HYPOTHESIS,
      },
      orderBy: { createdAt: "desc" },
      select: { valueJson: true },
    });

    if (!executionPlanClaim) {
      log.info({ projectId }, "Phase-F: skip (no execution_plan claim)");
      await writePhaseFAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-F aborted: execution_plan claim missing",
      });
      return { ok: false };
    }

    const executionCostPreviewClaim = await db.sourcingClaim.findFirst({
      where: {
        projectId,
        versionId: verifiedVersionId,
        fieldKey: FIELD_EXECUTION_COST_PREVIEW,
        claimType: ClaimType.HYPOTHESIS,
      },
      select: { id: true },
    });

    if (!executionCostPreviewClaim) {
      log.info({ projectId }, "Phase-F: skip (no execution_cost_preview claim)");
      await writePhaseFAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-F aborted: execution_cost_preview claim missing",
      });
      return { ok: false };
    }

    const approvalAudit = await db.auditAction.findFirst({
      where: {
        projectId,
        actionType: AuditActionType.execution_approved,
      },
      orderBy: { createdAt: "desc" },
      select: { actionType: true, actorRole: true, note: true },
    });

    if (!approvalAudit) {
      log.info({ projectId }, "Phase-F: skip (no execution_approved audit)");
      await writePhaseFAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-F aborted: execution_approved audit event missing",
      });
      return { ok: false };
    }

    const planSteps = (executionPlanClaim.valueJson as { steps?: Array<{ step?: string }> })?.steps ?? [];
    const planStepIds = planSteps.map((s) => s.step).filter((x): x is string => typeof x === "string");

    assertProjectVerified(project);
    assertExecutionPlanExists(executionPlanClaim);
    assertHumanApprovalExists(approvalAudit, planStepIds);

    let approvedSteps: string[];
    try {
      const note = approvalAudit.note ? (JSON.parse(approvalAudit.note) as { approved_steps?: string[] }) : {};
      approvedSteps = Array.isArray(note.approved_steps) ? note.approved_steps : [];
    } catch {
      approvedSteps = [];
    }

    if (approvedSteps.length === 0) {
      log.info({ projectId }, "Phase-F: skip (no approved_steps)");
      await writePhaseFAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-F aborted: approved_steps empty",
      });
      return { ok: false };
    }

    const { stepsPrepared } = await prepareExecutionActions(
      projectId,
      verifiedVersionId,
      approvedSteps,
      idempotencyKey,
      requestId,
      log,
    );

    await writePhaseFAudit(projectId, requestId, `${idempotencyKey}:execution_action`, "pipeline_run", {
      message: "Phase-F execution actions prepared",
      steps_prepared: stepsPrepared,
    });

    log.info({ projectId, steps_prepared: stepsPrepared }, "Phase-F execution actions prepared");
    return { ok: true, steps_prepared: stepsPrepared };
  } catch (err) {
    log.error({ err, projectId }, "Phase-F failed");
    await writePhaseFAudit(projectId, requestId, idempotencyKey, "edit_note", {
      message: `Phase-F failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { ok: false };
  }
}

async function writePhaseFAudit(
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
