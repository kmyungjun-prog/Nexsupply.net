/**
 * Internal Blueprint Review service (Phase-E/F/G).
 * Read-only for blueprint-review; audit append for approve-execution; runPhaseG for mark-sent.
 * Evidence: list, initiate (signed URL), complete (register after upload). Append-only; no delete/edit.
 */

import { randomUUID } from "crypto";
import { ActorRole, AuditActionType, ClaimType } from "@prisma/client";
import { db } from "../../libs/db.js";
import { getSignedUrl } from "../../libs/storage.js";
import { runPhaseG } from "../pipeline/executionResult/index.js";
import {
  FIELD_FACTORY_CANDIDATE,
  FIELD_FACTORY_RULE_FLAGS,
  FIELD_FACTORY_AI_EXPLANATION,
  FIELD_EXECUTION_PLAN,
  FIELD_EXECUTION_COST_PREVIEW,
  FIELD_EXECUTION_ACTION,
  FIELD_EXECUTION_ACTION_RESULT,
  FIELD_AUTOMATION_ELIGIBILITY,
} from "../pipeline/blueprint/fieldKeys.js";
import type {
  BlueprintReviewResponse,
  ClaimSummary,
  EvidenceListItem,
  EvidenceInitiateResponse,
  EvidenceCompleteResponse,
} from "./dto.js";

const FIELD_KEYS = [
  FIELD_FACTORY_CANDIDATE,
  FIELD_FACTORY_RULE_FLAGS,
  FIELD_FACTORY_AI_EXPLANATION,
  FIELD_EXECUTION_PLAN,
  FIELD_EXECUTION_COST_PREVIEW,
  FIELD_EXECUTION_ACTION,
  FIELD_EXECUTION_ACTION_RESULT,
  FIELD_AUTOMATION_ELIGIBILITY,
] as const;

function toClaimSummary(c: { id: string; fieldKey: string; claimType: ClaimType; valueJson: unknown; createdAt: Date }): ClaimSummary {
  return {
    id: c.id,
    fieldKey: c.fieldKey,
    claimType: c.claimType,
    valueJson: c.valueJson,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function getBlueprintReview(projectId: string): Promise<BlueprintReviewResponse | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      status: true,
      verifiedSnapshotJsonb: true,
      verifiedVersionId: true,
      activeVersionId: true,
    },
  });
  if (!project) return null;

  const versionId = project.verifiedVersionId ?? project.activeVersionId ?? project.id;

  const hasExecutionApproved = await db.auditAction
    .findFirst({
      where: { projectId, actionType: AuditActionType.execution_approved },
      select: { id: true },
    })
    .then((a) => !!a);

  const claims = await db.sourcingClaim.findMany({
    where: {
      projectId,
      versionId,
      fieldKey: { in: [...FIELD_KEYS] },
      claimType: { in: [ClaimType.HYPOTHESIS, ClaimType.VERIFIED] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, fieldKey: true, claimType: true, valueJson: true, createdAt: true },
  });

  const byField: Record<string, ClaimSummary[]> = {
    [FIELD_FACTORY_CANDIDATE]: [],
    [FIELD_FACTORY_RULE_FLAGS]: [],
    [FIELD_FACTORY_AI_EXPLANATION]: [],
    [FIELD_EXECUTION_PLAN]: [],
    [FIELD_EXECUTION_COST_PREVIEW]: [],
    [FIELD_EXECUTION_ACTION]: [],
    [FIELD_EXECUTION_ACTION_RESULT]: [],
    [FIELD_AUTOMATION_ELIGIBILITY]: [],
  };
  for (const c of claims) {
    if (byField[c.fieldKey]) byField[c.fieldKey].push(toClaimSummary(c));
  }

  return {
    project: {
      id: project.id,
      status: project.status,
      verifiedSnapshotJsonb: project.verifiedSnapshotJsonb,
      verifiedVersionId: project.verifiedVersionId,
    },
    hasExecutionApproved,
    claims: {
      factory_candidate: byField[FIELD_FACTORY_CANDIDATE],
      factory_rule_flags: byField[FIELD_FACTORY_RULE_FLAGS],
      factory_ai_explanation: byField[FIELD_FACTORY_AI_EXPLANATION],
      execution_plan: byField[FIELD_EXECUTION_PLAN],
      execution_cost_preview: byField[FIELD_EXECUTION_COST_PREVIEW],
      execution_action: byField[FIELD_EXECUTION_ACTION],
      execution_action_result: byField[FIELD_EXECUTION_ACTION_RESULT],
      automation_eligibility: byField[FIELD_AUTOMATION_ELIGIBILITY],
    },
  };
}

export async function createApprovalAudit(
  projectId: string,
  actorId: string,
  actorRole: string,
  approvedSteps: string[],
  idempotencyKey: string,
  requestId: string,
): Promise<{ ok: boolean; replayed: boolean }> {
  const existing = await db.auditAction.findFirst({
    where: {
      projectId,
      actionType: AuditActionType.execution_approved,
      idempotencyKey,
    },
    select: { id: true },
  });
  if (existing) return { ok: true, replayed: true };

  await db.auditAction.create({
    data: {
      projectId,
      actorId,
      actorRole: actorRole as ActorRole,
      actionType: AuditActionType.execution_approved,
      note: JSON.stringify({
        approved_steps: approvedSteps,
        approved_at: new Date().toISOString(),
      }),
      requestId,
      idempotencyKey,
    },
  });
  return { ok: true, replayed: false };
}

export async function markSent(
  projectId: string,
  step: string,
  evidenceIds: string[],
  actor: { uid: string; role: string },
  idempotencyKey: string,
  requestId: string,
  log: { info: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void },
): Promise<{ ok: boolean; message: string; step?: string; alreadyRecorded?: boolean }> {
  const result = await runPhaseG(
    projectId,
    step,
    evidenceIds,
    { uid: actor.uid, role: actor.role as "user" | "admin" },
    idempotencyKey,
    requestId,
    log,
  );
  if (result.alreadyRecorded) {
    return { ok: true, message: "Already recorded", step: result.step, alreadyRecorded: true };
  }
  if (!result.ok) {
    return { ok: false, message: "Phase-G failed or aborted", step: result.step };
  }
  return { ok: true, message: "Execution recorded", step: result.step };
}

const EVIDENCE_UPLOAD_EXPIRES_SECONDS = 15 * 60; // 15 minutes (SOW: 10–15 min)
const EVIDENCE_DOWNLOAD_EXPIRES_SECONDS = 10 * 60; // 10 minutes, short-lived for viewer

/** SOW: upload policy – file type, size, integrity. */
export const EVIDENCE_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
export const EVIDENCE_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

function sanitizeFilename(name: string): string {
  const basename = name.replace(/^.*[/\\]/, "").trim() || "file";
  return basename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

export async function listEvidence(projectId: string): Promise<EvidenceListItem[] | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) return null;

  const files = await db.evidenceFile.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      createdAt: true,
      uploadedByUserId: true,
      virusScanStatus: true,
    },
  });
  return files.map((f) => ({
    evidence_id: f.id,
    original_filename: f.originalFilename,
    mime_type: f.mimeType,
    size_bytes: Number(f.sizeBytes),
    sha256: f.sha256,
    created_at: f.createdAt.toISOString(),
    uploaded_by: f.uploadedByUserId,
    virus_scan_status: f.virusScanStatus,
  }));
}

export async function initiateEvidenceUpload(
  projectId: string,
  body: { original_filename: string; mime_type: string; size_bytes?: number; sha256?: string },
  uid: string,
): Promise<EvidenceInitiateResponse | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) return null;

  const sanitized = sanitizeFilename(body.original_filename);
  const randomId = randomUUID().replace(/-/g, "").slice(0, 12);
  const gcsPath = `projects/${projectId}/evidence/${randomId}_${sanitized}`;

  const uploadUrl = await getSignedUrl({
    action: "write",
    gcsPath,
    expiresInSeconds: EVIDENCE_UPLOAD_EXPIRES_SECONDS,
    contentType: body.mime_type,
  });

  const expiresAt = new Date(Date.now() + EVIDENCE_UPLOAD_EXPIRES_SECONDS * 1000);
  return {
    upload_url: uploadUrl,
    upload_headers: { "Content-Type": body.mime_type },
    gcs_path: gcsPath,
    upload_expires_at: expiresAt.toISOString(),
  };
}

export async function completeEvidenceUpload(
  projectId: string,
  body: { gcs_path: string; original_filename: string; mime_type: string; size_bytes: number; sha256?: string },
  uid: string,
): Promise<EvidenceCompleteResponse | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) return null;

  if (!body.gcs_path.startsWith(`projects/${projectId}/evidence/`)) {
    return null;
  }

  const created = await db.evidenceFile.create({
    data: {
      projectId,
      gcsPath: body.gcs_path,
      mimeType: body.mime_type,
      sha256: body.sha256 ?? "",
      sizeBytes: BigInt(body.size_bytes),
      originalFilename: body.original_filename,
      uploadedByUserId: uid,
    },
    select: { id: true, gcsPath: true },
  });
  return { evidence_id: created.id, gcs_path: created.gcsPath };
}

/** Short-lived signed URL for evidence download (Auditor Desk document viewer). Admin only. */
export async function getEvidenceDownloadUrl(
  projectId: string,
  evidenceId: string,
): Promise<{ url: string; expires_at: string } | null> {
  const file = await db.evidenceFile.findFirst({
    where: { id: evidenceId, projectId },
    select: { gcsPath: true },
  });
  if (!file) return null;
  const url = await getSignedUrl({
    action: "read",
    gcsPath: file.gcsPath,
    expiresInSeconds: EVIDENCE_DOWNLOAD_EXPIRES_SECONDS,
  });
  const expiresAt = new Date(Date.now() + EVIDENCE_DOWNLOAD_EXPIRES_SECONDS * 1000);
  return { url, expires_at: expiresAt.toISOString() };
}
