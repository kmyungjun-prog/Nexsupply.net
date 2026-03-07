import { randomUUID } from "crypto";
import { ActorRole, EventSource, ProjectStatus } from "@prisma/client";
import { db } from "../../libs/db.js";
import { getSignedUrl } from "../../libs/storage.js";
import { AppError } from "../../libs/errors.js";
import { jobs } from "../../libs/jobs.js";
import { transitionProject } from "../stateMachine/service.js";
import { analyzeProductPhoto } from "../pipeline/geminiVision.js";
import { createFactoryCandidateClaims } from "../pipeline/blueprint/rapidapi1688.js";
import { fetchFullSourcingJourney } from "../pipeline/blueprint/serpapi.js";

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
  body: {
    gcs_path: string;
    mime_type: string;
    size_bytes: number;
    original_filename?: string;
    destination_city?: string;
    quantity?: number;
  },
  uid: string
) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, ownerUserId: true } });
  if (!project || project.ownerUserId !== uid) return null;
  if (!body.gcs_path.startsWith(`projects/${projectId}/photo/`)) return null;
  if (body.size_bytes > PHOTO_MAX_SIZE_BYTES) return null;
  if (!(PHOTO_ALLOWED_MIME as readonly string[]).includes(body.mime_type)) return null;

  const destinationCity = body.destination_city?.trim() || "USA";
  const quantity = typeof body.quantity === "number" && body.quantity > 0 ? body.quantity : 500;

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

  const analysis = await analyzeProductPhoto(body.gcs_path, bucketName, body.mime_type, destinationCity, quantity);

  const keyword = analysis.search_keywords_1688?.[0] ?? analysis.product_name_zh ?? analysis.product_name ?? "";
  let imageUrl = "";
  try {
    imageUrl = await getSignedUrl({
      action: "read",
      gcsPath: body.gcs_path,
      expiresInSeconds: 3600,
    });
  } catch (_e) {
    // SerpApi Lens will be skipped if no URL
  }

  const journey = await fetchFullSourcingJourney({
    imageUrl,
    keyword,
    sourcingRegion: analysis.recommended_sourcing_region,
    destinationCity,
    shippingMethod: analysis.shipping_method,
    hintHsCode: analysis.hs_code_hint,
  });

  const versionId = randomUUID();
  await db.project.update({
    where: { id: projectId },
    data: { activeVersionId: versionId },
  });

  if (journey.step1_sourcing.length > 0) {
    await createFactoryCandidateClaims(
      projectId,
      versionId,
      `auto:${projectId}`,
      journey.step1_sourcing,
      `photo-complete:${projectId}`
    );
  }

  // Stamp Gemini-estimated price/MOQ onto each factory candidate as AI-backed evidence
  const step1WithEstimate = journey.step1_sourcing.map((c) => ({
    ...c,
    price_range: analysis.factory_price_range
      ? { min: analysis.factory_price_range.min, max: analysis.factory_price_range.max, currency: analysis.factory_price_range.currency }
      : c.price_range,
    moq: analysis.typical_moq ?? c.moq,
  }));

  const factoryCandidatesPreview = step1WithEstimate.slice(0, 5).map((c) => ({
    name: c.factory_name,
    location: c.location ?? "—",
    moq: c.moq,
    price_range: c.price_range,
    url: c.source_url,
    platform: c.platform,
  }));

  const resolvedViewJsonb = {
    product_name: analysis.product_name,
    product_name_zh: analysis.product_name_zh,
    category: analysis.category,
    material: analysis.material,
    estimated_specs: analysis.estimated_specs,
    search_keywords_1688: analysis.search_keywords_1688,
    recommended_sourcing_region: analysis.recommended_sourcing_region,
    hs_code_hint: analysis.hs_code_hint,
    shipping_method: analysis.shipping_method,
    certifications_required: analysis.certifications_required,
    special_notes: analysis.special_notes,
    factory_price_range: analysis.factory_price_range,
    typical_moq: analysis.typical_moq,
    _source: "gemini_vision",
    _analyzed_at: new Date().toISOString(),
    factory_candidates: factoryCandidatesPreview,
    step1_sourcing: step1WithEstimate,
    step2_qc_packaging: journey.step2_qc_packaging,
    step3_forwarding: journey.step3_forwarding,
    step4_customs: journey.step4_customs,
    step5_inland: journey.step5_inland,
  };
  await db.project.update({
    where: { id: projectId },
    data: { resolvedViewJsonb: resolvedViewJsonb as object, resolvedViewUpdatedAt: new Date() },
  });

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

