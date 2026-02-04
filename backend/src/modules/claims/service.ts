import { ActorRole, ClaimType, ProjectStatus } from "@prisma/client";
import { db } from "../../libs/db.js";
import { AppError } from "../../libs/errors.js";
import { buildResolvedView, type ResolvedView } from "./resolvedView.js";

/** Phase-E/Phase-F: field_keys allowed when appending to a VERIFIED project (execution plan / action only). */
const ALLOWED_VERIFIED_APPEND_FIELD_KEYS = [
  "execution_plan",
  "execution_cost_preview",
  "execution_action",
  "automation_eligibility",
] as const;

export async function appendClaim(input: {
  projectId: string;
  actor: { uid: string; role: ActorRole };
  fieldKey: string;
  valueJson: unknown;
  claimType: ClaimType;
  confidence?: number;
  currency?: string;
  unit?: string;
  sourceType?: "model" | "crawl" | "document" | "user" | "system" | "api";
  sourceRef?: string;
  versionId: string; // client-generated uuid recommended
  idempotencyKey?: string;
  evidenceIds?: string[];
  requestId: string;
  /** Phase-E/F: allow append when project is VERIFIED (system only, execution_plan / execution_cost_preview / execution_action). */
  allowWhenVerified?: boolean;
  /** Phase-G: allow user/admin to append VERIFIED execution_action_result when project is VERIFIED (evidence-backed). */
  allowVerifiedResult?: boolean;
}) {
  if (input.actor.role === ActorRole.user) {
    const allowVerifiedResult =
      input.allowVerifiedResult === true &&
      input.fieldKey === "execution_action_result" &&
      input.claimType === ClaimType.VERIFIED;
    if (input.claimType !== ClaimType.USER_PROVIDED && !allowVerifiedResult) {
      throw new AppError({ statusCode: 403, code: "FORBIDDEN", message: "User can only append USER_PROVIDED claims" });
    }
  }
  if (input.actor.role === ActorRole.auditor) {
    if (input.claimType === ClaimType.HYPOTHESIS) {
      throw new AppError({ statusCode: 403, code: "FORBIDDEN", message: "Auditor cannot append HYPOTHESIS claims" });
    }
  }

  if (input.idempotencyKey) {
    const existing = await db.sourcingClaim.findUnique({
      where: { projectId_idempotencyKey: { projectId: input.projectId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return { claim: existing, replayed: true };
  }

  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    let resolvedView: ResolvedView | undefined;
    const project = await tx.project.findUnique({ where: { id: input.projectId } });
    if (!project) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });

    // 접근 제어: 기본은 owner만. auditor/admin/system은 감사/검증을 위해 접근 허용.
    if (input.actor.role === ActorRole.user && project.ownerUserId !== input.actor.uid) {
      throw new AppError({ statusCode: 403, code: "FORBIDDEN", message: "No access to this project" });
    }

    // SOW: VERIFIED 이후 핵심 값 수정 금지 -> claim append로 resolved view가 바뀌는 것을 막는다.
    // Phase-E/F: system이 execution_plan / execution_cost_preview / execution_action (HYPOTHESIS) append 허용.
    // Phase-G: user/admin이 execution_action_result (VERIFIED) append 허용.
    const isVerifiedSystemAppend =
      project.status === ProjectStatus.VERIFIED &&
      input.allowWhenVerified === true &&
      input.actor.role === ActorRole.system &&
      project.verifiedVersionId != null &&
      input.versionId === project.verifiedVersionId &&
      ALLOWED_VERIFIED_APPEND_FIELD_KEYS.includes(input.fieldKey as (typeof ALLOWED_VERIFIED_APPEND_FIELD_KEYS)[number]);
    const isVerifiedResultAppend =
      project.status === ProjectStatus.VERIFIED &&
      input.allowVerifiedResult === true &&
      (input.actor.role === ActorRole.user || input.actor.role === ActorRole.admin) &&
      input.claimType === ClaimType.VERIFIED &&
      input.fieldKey === "execution_action_result" &&
      project.verifiedVersionId != null &&
      input.versionId === project.verifiedVersionId;
    const isVerifiedAppend = isVerifiedSystemAppend || isVerifiedResultAppend;

    if (project.status === ProjectStatus.VERIFIED && !isVerifiedAppend) {
      throw new AppError({
        statusCode: 409,
        code: "IMMUTABLE_CLAIM",
        message: "Project is VERIFIED; reopen to ANALYZING before appending new claims",
      });
    }

    const claim = await tx.sourcingClaim.create({
      data: {
        projectId: project.id,
        fieldKey: input.fieldKey,
        valueJson: input.valueJson as any,
        claimType: input.claimType,
        confidence: input.confidence,
        createdByRole: input.actor.role,
        createdByUserId: input.actor.uid,
        currency: input.currency,
        unit: input.unit,
        sourceType: input.sourceType as any,
        sourceRef: input.sourceRef,
        versionId: input.versionId,
        idempotencyKey: input.idempotencyKey,
      },
    });

    if (input.evidenceIds?.length) {
      const evidence = await tx.evidenceFile.findMany({
        where: { id: { in: input.evidenceIds }, projectId: project.id },
        select: { id: true },
      });
      const okIds = new Set(evidence.map((e) => e.id));
      const missing = input.evidenceIds.filter((id) => !okIds.has(id));
      if (missing.length) {
        throw new AppError({
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: "Evidence IDs not found in this project",
          details: { missing },
        });
      }

      await tx.claimEvidenceLink.createMany({
        data: input.evidenceIds.map((evidenceId) => ({
          claimId: claim.id,
          evidenceId,
        })),
        skipDuplicates: true,
      });
    }

    // Phase-E: VERIFIED append 시 프로젝트 상태/스냅샷 갱신 금지 (read-only).
    if (!isVerifiedAppend) {
      const activeVersionId = project.activeVersionId ?? input.versionId;
      const nextActiveVersionId = activeVersionId === input.versionId ? activeVersionId : input.versionId;

      const versionClaims = await tx.sourcingClaim.findMany({
        where: { projectId: project.id, versionId: nextActiveVersionId },
        orderBy: { createdAt: "asc" },
      });
      resolvedView = buildResolvedView(nextActiveVersionId, versionClaims);

      await tx.project.update({
        where: { id: project.id },
        data: {
          activeVersionId: nextActiveVersionId,
          resolvedViewJsonb: resolvedView as any,
          resolvedViewUpdatedAt: now,
        },
      });
    }

    await tx.auditAction.create({
      data: {
        projectId: project.id,
        actorId: input.actor.uid,
        actorRole: input.actor.role,
        actionType: "claim_append",
        note: `append claim ${input.fieldKey} (${input.claimType})`,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
      },
    });

    return { claim, replayed: false, resolvedView };
  });

  return result;
}

