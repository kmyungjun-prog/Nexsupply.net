import type { FastifyInstance } from "fastify";
import { ClaimType } from "@prisma/client";
import { authenticate } from "../../libs/auth.js";
import { appendClaim } from "./service.js";

export async function registerClaimsRoutes(app: FastifyInstance) {
  app.post(
    "/claims",
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: "object",
          required: ["projectId", "fieldKey", "valueJson", "claimType", "versionId"],
          properties: {
            projectId: { type: "string" },
            fieldKey: { type: "string", minLength: 1 },
            valueJson: {
              anyOf: [
                { type: "object" },
                { type: "array" },
                { type: "string" },
                { type: "number" },
                { type: "boolean" },
                { type: "null" },
              ],
            },
            claimType: { type: "string", enum: ["HYPOTHESIS", "USER_PROVIDED", "VERIFIED"] },
            confidence: { type: "number" },
            currency: { type: "string" },
            unit: { type: "string" },
            sourceType: { type: "string", enum: ["model", "crawl", "document", "user", "system"] },
            sourceRef: { type: "string" },
            versionId: { type: "string" },
            evidenceIds: { type: "array", items: { type: "string" } },
            idempotencyKey: { type: "string" }
          },
        },
      },
    },
    async (req) => {
      const body = req.body as any;
      const actor = { uid: req.auth!.uid, role: req.auth!.role as any };
      const result = await appendClaim({
        projectId: body.projectId,
        actor,
        fieldKey: body.fieldKey,
        valueJson: body.valueJson,
        claimType: body.claimType as ClaimType,
        confidence: body.confidence,
        currency: body.currency,
        unit: body.unit,
        sourceType: body.sourceType,
        sourceRef: body.sourceRef,
        versionId: body.versionId,
        evidenceIds: body.evidenceIds,
        idempotencyKey: (req.headers["idempotency-key"] as string | undefined) ?? body.idempotencyKey,
        requestId: req.id,
      });
      return result;
    },
  );
}

