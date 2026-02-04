/**
 * Internal Blueprint Review API (Phase-E/F/G).
 * Admin/system only. Read-only for blueprint-review; audit append for approve; runPhaseG for mark-sent.
 */

import type { FastifyInstance } from "fastify";
import { authenticate } from "../../libs/auth.js";
import { requireRole } from "../../libs/auth.js";
import { getIdempotencyKey, requireIdempotencyKey } from "../../libs/idempotency.js";
import { AppError } from "../../libs/errors.js";
import { runPhaseH } from "../pipeline/automationEligibility/index.js";
import {
  getBlueprintReview,
  createApprovalAudit,
  markSent,
  listEvidence,
  initiateEvidenceUpload,
  completeEvidenceUpload,
  getEvidenceDownloadUrl,
  EVIDENCE_ALLOWED_MIME_TYPES,
  EVIDENCE_MAX_FILE_SIZE_BYTES,
} from "./service.js";

export async function registerInternalReviewRoutes(app: FastifyInstance) {
  const adminOrSystem = requireRole(["admin", "system"]);

  app.get<{ Params: { id: string } }>(
    "/internal/projects/:id/blueprint-review",
    {
      preHandler: [authenticate, adminOrSystem],
    },
    async (req, reply) => {
      const { id: projectId } = req.params;
      const data = await getBlueprintReview(projectId);
      if (!data) {
        throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
      }
      return data;
    },
  );

  app.post<{
    Params: { id: string };
    Body: { approved_steps: string[] };
  }>(
    "/internal/projects/:id/approve-execution",
    {
      preHandler: [authenticate, adminOrSystem, requireIdempotencyKey],
      schema: {
        body: {
          type: "object",
          required: ["approved_steps"],
          properties: {
            approved_steps: { type: "array", items: { type: "string" } },
          },
        },
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id: projectId } = req.params;
      const { approved_steps } = req.body;
      if (!Array.isArray(approved_steps) || approved_steps.length === 0) {
        throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "approved_steps must be a non-empty array" });
      }
      const idempotencyKey = req.idempotencyKey!;
      const { ok, replayed } = await createApprovalAudit(
        projectId,
        req.auth!.uid,
        req.auth!.role,
        approved_steps,
        idempotencyKey,
        req.id,
      );
      return { ok, message: replayed ? "Already approved (idempotent)" : "Execution approved", replayed };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { step: string; evidence_ids: string[] };
  }>(
    "/internal/projects/:id/mark-sent",
    {
      preHandler: [authenticate, adminOrSystem],
      schema: {
        body: {
          type: "object",
          required: ["step", "evidence_ids"],
          properties: {
            step: { type: "string" },
            evidence_ids: { type: "array", items: { type: "string" } },
          },
        },
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id: projectId } = req.params;
      const { step, evidence_ids } = req.body;
      if (!evidence_ids || !Array.isArray(evidence_ids)) {
        throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "evidence_ids must be an array" });
      }
      const idempotencyKey = getIdempotencyKey(req) ?? `mark-sent:${projectId}:${step}:${Date.now()}`;
      const result = await markSent(
        projectId,
        step,
        evidence_ids,
        { uid: req.auth!.uid, role: req.auth!.role },
        idempotencyKey,
        req.id,
        req.log,
      );
      if (result.alreadyRecorded) {
        return reply.code(200).send({ ok: true, message: "Already recorded", step: result.step, alreadyRecorded: true });
      }
      if (!result.ok) {
        return reply.code(400).send({ ok: false, message: result.message, step: result.step });
      }
      return { ok: true, message: result.message, step: result.step };
    },
  );

  // Evidence (append-only; no delete/edit)
  app.get<{ Params: { id: string } }>(
    "/internal/projects/:id/evidence",
    {
      preHandler: [authenticate, adminOrSystem],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id: projectId } = req.params;
      const list = await listEvidence(projectId);
      if (list === null) {
        throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
      }
      return list;
    },
  );

  app.post<{
    Params: { id: string };
    Body: { original_filename: string; mime_type: string; size_bytes?: number; sha256?: string };
  }>(
    "/internal/projects/:id/evidence/initiate",
    {
      preHandler: [authenticate, adminOrSystem],
      schema: {
        body: {
          type: "object",
          required: ["original_filename", "mime_type"],
          properties: {
            original_filename: { type: "string" },
            mime_type: { type: "string" },
            size_bytes: { type: "number" },
            sha256: { type: "string" },
          },
        },
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id: projectId } = req.params;
      const body = req.body;
      if (!(EVIDENCE_ALLOWED_MIME_TYPES as readonly string[]).includes(body.mime_type)) {
        throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "mime_type not allowed for evidence upload" });
      }
      if (body.size_bytes != null && body.size_bytes > EVIDENCE_MAX_FILE_SIZE_BYTES) {
        throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "size_bytes exceeds maximum" });
      }
      const result = await initiateEvidenceUpload(projectId, body, req.auth!.uid);
      if (result === null) {
        throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
      }
      return result;
    },
  );

  app.post<{
    Params: { id: string };
    Body: { gcs_path: string; original_filename: string; mime_type: string; size_bytes: number; sha256?: string };
  }>(
    "/internal/projects/:id/evidence/complete",
    {
      preHandler: [authenticate, adminOrSystem],
      schema: {
        body: {
          type: "object",
          required: ["gcs_path", "original_filename", "mime_type", "size_bytes"],
          properties: {
            gcs_path: { type: "string" },
            original_filename: { type: "string" },
            mime_type: { type: "string" },
            size_bytes: { type: "number" },
            sha256: { type: "string" },
          },
        },
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id: projectId } = req.params;
      const body = req.body;
      if (!(EVIDENCE_ALLOWED_MIME_TYPES as readonly string[]).includes(body.mime_type)) {
        throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "mime_type not allowed for evidence upload" });
      }
      if (body.size_bytes > EVIDENCE_MAX_FILE_SIZE_BYTES) {
        throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "size_bytes exceeds maximum" });
      }
      const result = await completeEvidenceUpload(projectId, body, req.auth!.uid);
      if (result === null) {
        throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found or invalid gcs_path" });
      }
      return result;
    },
  );

  app.get<{ Params: { id: string; evidenceId: string } }>(
    "/internal/projects/:id/evidence/:evidenceId/signed-url",
    {
      preHandler: [authenticate, adminOrSystem],
      schema: {
        params: {
          type: "object",
          required: ["id", "evidenceId"],
          properties: { id: { type: "string" }, evidenceId: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id: projectId, evidenceId } = req.params;
      const result = await getEvidenceDownloadUrl(projectId, evidenceId);
      if (result === null) {
        throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Evidence not found" });
      }
      return result;
    },
  );

  // Phase-H: run automation eligibility evaluation (admin/system only; idempotent; append-only claim).
  app.post<{ Params: { id: string } }>(
    "/internal/projects/:id/run-phase-h",
    {
      preHandler: [authenticate, adminOrSystem],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id: projectId } = req.params;
      const idempotencyKey = getIdempotencyKey(req) ?? `run-phase-h:${projectId}:${new Date().toISOString().slice(0, 10)}`;
      const result = await runPhaseH(projectId, idempotencyKey, req.id, req.log);
      return { ok: result.ok, eligible: result.eligible };
    },
  );
}
