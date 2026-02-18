import { randomUUID } from "crypto";
import { ActorRole, EventSource, ProjectStatus } from "@prisma/client";
import { db } from "../../libs/db.js";
import { getSignedUrl } from "../../libs/storage.js";
import { AppError } from "../../libs/errors.js";
import { jobs } from "../../libs/jobs.js";
import { transitionProject } from "../stateMachine/service.js";
import { analyzeProductPhoto } from "../pipeline/geminiVision.js";
import { fetchFactoryCandidates, createFactoryCandidateClaims } from "../pipeline/blueprint/rapidapi1688.js";

export type Actor = { uid: string; role: ActorRole };

const PHOTO_UPLOAD_EXPIRES_SECONDS = 15 * 60;
const PHOTO_ALLOWED_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const PHOTO_MAX_SIZE_BYTES = 25 * 1024 * 1024;

export async function createProject(input: { ownerUserId: string }) {
  const project = await db.project.create({
    data: {
      ownerUserId: input.ownerUserId,
      status: ProjectStatus.ANALYZING,
      resolvedViewJsonb: {},
    },
  });
  return project;
}

export async function getProjectForReport(projectId: string) {
  return db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      status: true,
      ownerUserId: true,
      resolvedViewJsonb: true,
      resolvedViewUpdatedAt: true,
      createdAt: true,
    },
  });
}

export type InitiatePhotoResult = {
  project_id: string;
  upload_url: string;
  upload_headers: Record<string, string>;
  gcs_path: string;
  upload_expires_at: string;
};

export async function initiatePhotoUpload(ownerUserId: string, mimeType: string): Promise<InitiatePhotoResult | null> {
  if (!(PHOTO_ALLOWED_MIME as readonly string[]).includes(mimeType)) return null;
  const project = await createProject({ ownerUserId });
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : mimeType === "image/gif" ? "gif" : "webp";
  const gcsPath = `projects/${project.id}/photo/initial_${randomUUID().replace(/-/g, "").slice(0, 12)}.${ext}`;
  const uploadUrl = await getSignedUrl({
    action: "write",
    gcsPath,
    expiresInSeconds: PHOTO_UPLOAD_EXPIRES_SECONDS,
    contentType: mimeType,
  });
  const expiresAt = new Date(Date.now() + PHOTO_UPLOAD_EXPIRES_SECONDS * 1000);
  return {
    project_id: project.id,
    upload_url: uploadUrl,
    upload_headers: { "Content-Type": mimeType },
    gcs_path: gcsPath,
    upload_expires_at: expiresAt.toISOString(),
  };
}

export async function completePhotoUpload(
  projectId: string,
  body: { gcs_path: string; mime_type: string; size_bytes: number; original_filename?: string },
  uid: string
) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, ownerUserId: true } });
  if (!project || project.ownerUserId !== uid) return null;
  if (!body.gcs_path.startsWith(`projects/${projectId}/photo/`)) return null;
  if (body.size_bytes > PHOTO_MAX_SIZE_BYTES) return null;
  if (!(PHOTO_ALLOWED_MIME as readonly string[]).includes(body.mime_type)) return null;

  await db.evidenceFile.create({
    data: {
      projectId,
      gcsPath: body.gcs_path,
      mimeType: body.mime_type,
      sha256: "",
      sizeBytes: BigInt(body.size_bytes),
      originalFilename: body.original_filename ?? "photo",
      uploadedByUserId: uid,
    },
  });

  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new AppError({ statusCode: 500, code: "CONFIG", message: "GCS_BUCKET_NAME is not set" });
  }
  const analysis = await analyzeProductPhoto(body.gcs_path, bucketName, body.mime_type);

  const resolvedViewJsonb = {
    product_name: analysis.product_name,
    product_name_zh: analysis.product_name_zh,
    category: analysis.category,
    material: analysis.material,
    estimated_specs: analysis.estimated_specs,
    search_keywords_1688: analysis.search_keywords_1688,
    _source: "gemini_vision",
    _analyzed_at: new Date().toISOString(),
  };
  await db.project.update({
    where: { id: projectId },
    data: { resolvedViewJsonb: resolvedViewJsonb as object, resolvedViewUpdatedAt: new Date() },
  });

  // 무료 미니 파이프라인: 1688 검색만 실행 (최대 3개 후보를 resolvedViewJsonb에 저장)
  try {
    const searchQuery =
      analysis.search_keywords_1688?.[0] ?? analysis.product_name_zh ?? analysis.product_name ?? "";
    const candidates = await fetchFactoryCandidates(searchQuery);
    if (candidates.length > 0) {
      const versionId = randomUUID();
      await db.project.update({
        where: { id: projectId },
        data: { activeVersionId: versionId },
      });
      await createFactoryCandidateClaims(
        projectId,
        versionId,
        `auto:${projectId}`,
        candidates,
        `photo-complete:${projectId}`
      );
      const factoryCandidatesPreview = candidates.slice(0, 3).map((c) => ({
        name: c.factory_name,
        location: c.location ?? "—",
        moq: c.moq,
        price_range: c.price_range,
        url: c.source_url,
      }));
      const updatedView = {
        ...resolvedViewJsonb,
        factory_candidates: factoryCandidatesPreview,
      };
      await db.project.update({
        where: { id: projectId },
        data: { resolvedViewJsonb: updatedView as object, resolvedViewUpdatedAt: new Date() },
      });
    }
  } catch (err) {
    console.error("Mini pipeline (1688 search) failed:", err);
  }

  // Auto-trigger blueprint (free): ANALYZING → BLUEPRINT_RUNNING, then enqueue pipeline. Non-blocking.
  const idempotencyKey = `auto-blueprint:${projectId}`;
  const requestId = `request:${idempotencyKey}`;
  try {
    const result = await transitionProject({
      projectId,
      toStatus: ProjectStatus.BLUEPRINT_RUNNING,
      reason: "Auto-trigger after photo analysis",
      source: EventSource.system,
      actor: { uid: "system", role: ActorRole.system },
      idempotencyKey,
      requestId,
      setIsPaidBlueprint: true,
    });
    if (result.project && !result.replayed) {
      await jobs.enqueue({
        name: "blueprint_pipeline",
        payload: {
          projectId,
          versionId: result.project.activeVersionId ?? projectId,
          idempotencyKey,
        },
        idempotencyKey,
      });
    }
  } catch (_err) {
    // If transition or enqueue fails, project stays ANALYZING; do not throw to client.
  }

  return { project_id: projectId, analysis };
}

export async function listProjectsForActor(actor: Actor) {
  if (actor.role === "admin" || actor.role === "auditor" || actor.role === "system") {
    return db.project.findMany({ orderBy: { createdAt: "desc" } });
  }
  return db.project.findMany({
    where: { ownerUserId: actor.uid },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProjectOrThrow(projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
  return project;
}

export function assertProjectAccess(project: { ownerUserId: string }, actor: Actor) {
  if (actor.role === "admin" || actor.role === "auditor" || actor.role === "system") return;
  if (project.ownerUserId !== actor.uid) {
    throw new AppError({ statusCode: 403, code: "FORBIDDEN", message: "No access to this project" });
  }
}

