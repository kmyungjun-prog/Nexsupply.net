/**
 * Phase-G: Irreversible execution recording.
 * Records human-declared execution with evidence only.
 * NEVER executes actions; NEVER infers without evidence.
 *
 * Triggered by human UI "Mark as Sent" with evidence upload.
 */

import { ActorRole, AuditActionType, ProjectStatus } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { recordExecutionResult } from "./record.js";

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };

export type PhaseGResult = { ok: boolean; step?: string; alreadyRecorded?: boolean };

/**
 * Run Phase-G only when: VERIFIED, execution_action (prepared) exists for step, evidence provided, human actor.
 * On entry failure: audit edit_note, return { ok: false }. Do not throw.
 * On success: pipeline_run audit with step; return { ok: true, step }.
 */
export async function runPhaseG(
  projectId: string,
  step: string,
  evidenceIds: string[],
  actor: { uid: string; role: ActorRole },
  idempotencyKey: string,
  requestId: string,
  log: { info: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void },
): Promise<PhaseGResult> {
  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, verifiedVersionId: true },
    });

    if (!project) {
      log.error({ projectId }, "Phase-G: project not found");
      await writePhaseGAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-G aborted: project not found",
      });
      return { ok: false };
    }

    if (project.status !== ProjectStatus.VERIFIED) {
      log.info({ projectId, status: project.status }, "Phase-G: skip (not VERIFIED)");
      await writePhaseGAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-G aborted: project not VERIFIED",
        status: project.status,
      });
      return { ok: false };
    }

    if (project.verifiedVersionId == null || project.verifiedVersionId === "") {
      log.info({ projectId }, "Phase-G: skip (no verified_version_id)");
      await writePhaseGAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-G aborted: verifiedVersionId missing",
      });
      return { ok: false };
    }

    if (evidenceIds.length === 0) {
      log.info({ projectId, step }, "Phase-G: skip (evidence_ids empty)");
      await writePhaseGAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-G aborted: evidence_ids must be non-empty",
        step,
      });
      return { ok: false };
    }

    if (actor.role !== ActorRole.user && actor.role !== ActorRole.admin) {
      log.info({ projectId, step, role: actor.role }, "Phase-G: skip (actor must be user or admin)");
      await writePhaseGAudit(projectId, requestId, idempotencyKey, "edit_note", {
        message: "Phase-G aborted: execution_marked_sent must be by user or admin",
        step,
      });
      return { ok: false };
    }

    const verifiedVersionId = project.verifiedVersionId;

    const recordResult = await recordExecutionResult(
      projectId,
      step,
      evidenceIds,
      actor,
      verifiedVersionId,
      idempotencyKey,
      requestId,
      log,
    );

    if (recordResult.alreadyRecorded) {
      return { ok: true, step, alreadyRecorded: true };
    }

    await writePhaseGAudit(projectId, requestId, `${idempotencyKey}:execution_result`, "pipeline_run", {
      message: "Phase-G execution recorded",
      step,
    });

    log.info({ projectId, step }, "Phase-G execution recorded");
    return { ok: true, step };
  } catch (err) {
    log.error({ err, projectId, step }, "Phase-G failed");
    await writePhaseGAudit(projectId, requestId, idempotencyKey, "edit_note", {
      message: `Phase-G failed: ${err instanceof Error ? err.message : String(err)}`,
      step,
    });
    return { ok: false };
  }
}

async function writePhaseGAudit(
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
