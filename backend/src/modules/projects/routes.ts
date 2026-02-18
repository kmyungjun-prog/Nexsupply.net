import type { FastifyInstance } from "fastify";
import { ProjectStatus } from "@prisma/client";
import { authenticate } from "../../libs/auth.js";
import { requireIdempotencyKey } from "../../libs/idempotency.js";
import { AppError } from "../../libs/errors.js";
import { jobs } from "../../libs/jobs.js";
import {
  createProject,
  listProjectsForActor,
  getProjectOrThrow,
  getProjectForReport,
  assertProjectAccess,
  initiatePhotoUpload,
  completePhotoUpload,
} from "./service.js";
import {
  listEvidence,
  initiateEvidenceUpload,
  completeEvidenceUpload,
  EVIDENCE_ALLOWED_MIME_TYPES,
  EVIDENCE_MAX_FILE_SIZE_BYTES,
} from "../internalReview/service.js";
import { transitionProject } from "../stateMachine/service.js";

export async function registerProjectsRoutes(app: FastifyInstance) {
  app.post(
    "/projects",
    {
      preHandler: [authenticate],
    },
    async (req) => {
      const actor = { uid: req.auth!.uid, role: req.auth!.role as any };
      const project = await createProject({ ownerUserId: actor.uid });
      return { project };
    },
  );

  app.get(
    "/projects/:id",
    {
      preHandler: [authenticate],
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const project = await getProjectForReport(id);
      if (!project) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
      assertProjectAccess(project, { uid: req.auth!.uid, role: req.auth!.role as any });
      return project;
    },
  );

  app.post(
    "/projects/initiate-photo",
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: "object",
          required: ["mime_type"],
          properties: { mime_type: { type: "string" }, size_bytes: { type: "number" } },
        },
      },
    },
    async (req) => {
      const body = req.body as { mime_type: string; size_bytes?: number };
      try {
        const result = await initiatePhotoUpload(req.auth!.uid, body.mime_type);
        if (!result) throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "mime_type not allowed or invalid" });
        if (body.size_bytes != null && body.size_bytes > 25 * 1024 * 1024) {
          throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "size_bytes exceeds maximum" });
        }
        return result;
      } catch (e) {
        if (e instanceof AppError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        req.log.warn({ err: e }, "initiate-photo failed");
        throw new AppError({ statusCode: 500, code: "INTERNAL", message: msg });
      }
    },
  );

  app.post(
    "/projects/:id/photo/complete",
    {
      preHandler: [authenticate, requireIdempotencyKey],
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["gcs_path", "mime_type", "size_bytes"],
          properties: {
            gcs_path: { type: "string" },
            mime_type: { type: "string" },
            size_bytes: { type: "number" },
            original_filename: { type: "string" },
          },
        },
      },
    },
    async (req) => {
      const { id: projectId } = req.params as { id: string };
      const body = req.body as { gcs_path: string; mime_type: string; size_bytes: number; original_filename?: string };
      try {
        const result = await completePhotoUpload(projectId, body, req.auth!.uid);
        if (!result) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found or invalid" });
        return result;
      } catch (e) {
        if (e instanceof AppError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        req.log.warn({ err: e }, "photo/complete failed");
        throw new AppError({ statusCode: 500, code: "INTERNAL", message: msg });
      }
    },
  );

  app.get(
    "/projects",
    {
      preHandler: [authenticate],
    },
    async (req) => {
      const actor = { uid: req.auth!.uid, role: req.auth!.role as any };
      const projects = await listProjectsForActor(actor);
      return { projects };
    },
  );

  app.get(
    "/projects/:id/evidence",
    {
      preHandler: [authenticate],
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      },
    },
    async (req) => {
      const { id: projectId } = req.params as { id: string };
      const project = await getProjectForReport(projectId);
      if (!project) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
      assertProjectAccess(project, { uid: req.auth!.uid, role: req.auth!.role as any });
      const list = await listEvidence(projectId);
      if (list === null) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
      return list;
    },
  );

  app.post(
    "/projects/:id/evidence/initiate",
    {
      preHandler: [authenticate],
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["original_filename", "mime_type"],
          properties: {
            original_filename: { type: "string" },
            mime_type: { type: "string" },
            size_bytes: { type: "number" },
          },
        },
      },
    },
    async (req) => {
      const { id: projectId } = req.params as { id: string };
      const project = await getProjectForReport(projectId);
      if (!project) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
      assertProjectAccess(project, { uid: req.auth!.uid, role: req.auth!.role as any });
      const body = req.body as { original_filename: string; mime_type: string; size_bytes?: number };
      if (!(EVIDENCE_ALLOWED_MIME_TYPES as readonly string[]).includes(body.mime_type)) {
        throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "mime_type not allowed" });
      }
      if (body.size_bytes != null && body.size_bytes > EVIDENCE_MAX_FILE_SIZE_BYTES) {
        throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "size_bytes exceeds maximum" });
      }
      const result = await initiateEvidenceUpload(projectId, body, req.auth!.uid);
      if (result === null) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
      return result;
    },
  );

  app.post(
    "/projects/:id/evidence/complete",
    {
      preHandler: [authenticate, requireIdempotencyKey],
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["gcs_path", "original_filename", "mime_type", "size_bytes"],
          properties: {
            gcs_path: { type: "string" },
            original_filename: { type: "string" },
            mime_type: { type: "string" },
            size_bytes: { type: "number" },
          },
        },
      },
    },
    async (req) => {
      const { id: projectId } = req.params as { id: string };
      const project = await getProjectForReport(projectId);
      if (!project) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
      assertProjectAccess(project, { uid: req.auth!.uid, role: req.auth!.role as any });
      const body = req.body as { gcs_path: string; original_filename: string; mime_type: string; size_bytes: number };
      if (!(EVIDENCE_ALLOWED_MIME_TYPES as readonly string[]).includes(body.mime_type)) {
        throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "mime_type not allowed" });
      }
      if (body.size_bytes > EVIDENCE_MAX_FILE_SIZE_BYTES) {
        throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "size_bytes exceeds maximum" });
      }
      const result = await completeEvidenceUpload(projectId, body, req.auth!.uid);
      if (result === null) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Invalid gcs_path or project" });
      return result;
    },
  );

  app.post(
    "/projects/:id/transition",
    {
      preHandler: [authenticate, requireIdempotencyKey],
      schema: {
        body: {
          type: "object",
          required: ["toStatus"],
          properties: {
            toStatus: { type: "string" },
            reason: { type: "string" },
            source: { type: "string", enum: ["ui", "slack", "system"] },
            idempotencyKey: { type: "string" },
            setIsPaidBlueprint: { type: "boolean" },
          },
        },
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req) => {
      const actor = { uid: req.auth!.uid, role: req.auth!.role as any };
      const { id } = req.params as { id: string };
      const project = await getProjectOrThrow(id);
      assertProjectAccess(project, actor);

      const body = req.body as { toStatus: string; reason?: string; source?: string; setIsPaidBlueprint?: boolean };
      const result = await transitionProject({
        projectId: project.id,
        toStatus: body.toStatus,
        reason: body.reason,
        source: (body.source as any) ?? "ui",
        actor,
        idempotencyKey: req.idempotencyKey!,
        requestId: req.id,
        setIsPaidBlueprint: body.setIsPaidBlueprint,
      });

      const proj = result.project;
      if (proj && !result.replayed && proj.status === ProjectStatus.BLUEPRINT_RUNNING && body.setIsPaidBlueprint) {
        await jobs.enqueue({
          name: "blueprint_pipeline",
          payload: {
            projectId: proj.id,
            versionId: proj.activeVersionId ?? proj.id,
            idempotencyKey: req.idempotencyKey!,
          },
          idempotencyKey: req.idempotencyKey!,
        });
      }
      if (proj && proj.status === ProjectStatus.WAITING_PAYMENT && !result.replayed && req.server.sendPaymentRequestNotification) {
        req.server.sendPaymentRequestNotification(proj.id).catch((err) => req.log.warn({ err, projectId: proj.id }, "Slack payment notification failed"));
      }
      return result;
    },
  );
}

