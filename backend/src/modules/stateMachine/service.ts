import { ActorRole, EventSource, ProjectStatus } from "@prisma/client";
import { db } from "../../libs/db.js";
import { AppError, assertUnreachable } from "../../libs/errors.js";

const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  [ProjectStatus.ANALYZING]: [ProjectStatus.WAITING_PAYMENT, ProjectStatus.BLUEPRINT_RUNNING, ProjectStatus.AUDIT_IN_PROGRESS],
  [ProjectStatus.WAITING_PAYMENT]: [ProjectStatus.BLUEPRINT_RUNNING, ProjectStatus.ANALYZING],
  [ProjectStatus.BLUEPRINT_RUNNING]: [ProjectStatus.AUDIT_IN_PROGRESS, ProjectStatus.ANALYZING],
  [ProjectStatus.AUDIT_IN_PROGRESS]: [ProjectStatus.VERIFIED, ProjectStatus.ANALYZING],
  // SOW: VERIFIED 이후 핵심 값 수정 금지. 필요 시 "새 Claim + 새 버전 Verified"를 위해
  // admin/system만 VERIFIED -> ANALYZING 재오픈을 허용(새 verification cycle 시작).
  [ProjectStatus.VERIFIED]: [ProjectStatus.ANALYZING],
};

function parseStatus(x: unknown): ProjectStatus {
  if (typeof x !== "string") {
    throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "toStatus must be a string" });
  }
  const v = x as ProjectStatus;
  switch (v) {
    case ProjectStatus.ANALYZING:
    case ProjectStatus.WAITING_PAYMENT:
    case ProjectStatus.BLUEPRINT_RUNNING:
    case ProjectStatus.AUDIT_IN_PROGRESS:
    case ProjectStatus.VERIFIED:
      return v;
    default:
      throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "Invalid toStatus" });
  }
}

export async function transitionProject(input: {
  projectId: string;
  toStatus: unknown;
  reason?: string;
  source: EventSource;
  actor: { uid: string; role: ActorRole };
  idempotencyKey: string;
  requestId: string;
  /** Phase-B: when true and toStatus === BLUEPRINT_RUNNING, set isPaidBlueprint = true (e.g. Slack Confirm Payment). */
  setIsPaidBlueprint?: boolean;
}) {
  const toStatus = parseStatus(input.toStatus);

  const existing = await db.projectStatusEvent.findUnique({
    where: { projectId_idempotencyKey: { projectId: input.projectId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) {
    const project = await db.project.findUnique({ where: { id: input.projectId } });
    return { project, replayed: true, event: existing };
  }

  if (toStatus === ProjectStatus.VERIFIED && input.actor.role !== ActorRole.admin) {
    throw new AppError({ statusCode: 403, code: "FORBIDDEN", message: "Only admin can transition to VERIFIED" });
  }

  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: input.projectId } });
    if (!project) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });

    const fromStatus = project.status;
    const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new AppError({
        statusCode: 409,
        code: "INVALID_TRANSITION",
        message: `Invalid transition: ${fromStatus} -> ${toStatus}`,
      });
    }

    // VERIFIED -> ANALYZING은 admin/system만 허용
    if (fromStatus === ProjectStatus.VERIFIED && toStatus === ProjectStatus.ANALYZING) {
      if (input.actor.role !== ActorRole.admin && input.actor.role !== ActorRole.system) {
        throw new AppError({ statusCode: 403, code: "FORBIDDEN", message: "Only admin/system can reopen VERIFIED" });
      }
    }

    // VERIFIED 전환 시점: snapshot 고정 (Resolved View 재현성)
    const verifiedFields =
      toStatus === ProjectStatus.VERIFIED
        ? (() => {
            if (!project.activeVersionId) {
              throw new AppError({
                statusCode: 409,
                code: "CONFLICT",
                message: "Cannot verify without an activeVersionId (append at least one claim first)",
              });
            }
            return {
              verifiedAt: now,
              verifiedVersionId: project.activeVersionId,
              verifiedSnapshotJsonb: project.resolvedViewJsonb ?? {},
            };
          })()
        : {};

    // Phase-B: Slack Confirm Payment → BLUEPRINT_RUNNING with is_paid_blueprint = true
    const paidBlueprintFields =
      toStatus === ProjectStatus.BLUEPRINT_RUNNING && input.setIsPaidBlueprint === true
        ? { isPaidBlueprint: true }
        : {};

    const updatedProject = await tx.project.update({
      where: { id: project.id },
      data: {
        status: toStatus,
        ...verifiedFields,
        ...paidBlueprintFields,
      },
    });

    const event = await tx.projectStatusEvent.create({
      data: {
        projectId: project.id,
        fromStatus,
        toStatus,
        actorId: input.actor.uid,
        actorRole: input.actor.role,
        reason: input.reason,
        source: input.source,
        idempotencyKey: input.idempotencyKey,
      },
    });

    await tx.auditAction.create({
      data: {
        projectId: project.id,
        actorId: input.actor.uid,
        actorRole: input.actor.role,
        actionType: "status_transition",
        note: input.reason ?? `${fromStatus} -> ${toStatus}`,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
      },
    });

    return { project: updatedProject, replayed: false, event };
  });

  // ensure exhaustive compile-time for EventSource if changed
  switch (input.source) {
    case EventSource.ui:
    case EventSource.slack:
    case EventSource.system:
      break;
    default:
      assertUnreachable(input.source);
  }

  return result;
}

